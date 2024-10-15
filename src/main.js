// main.js
import express from "express";
import dotenv from "dotenv";
import { google } from "googleapis";
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';  //Realizar peticiones al servidor
import Bottleneck from 'bottleneck'; // Para validar el limite de solicitudes a la Api de Google
import winston from 'winston'; // Para los registros en logs

import {
  getAuthUrl,
  handleOAuthCallback,
  loadSavedCredentials,
} from "./auth.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

const drive_sheets = process.env.DRIVE_SHEETS;
const drive_pdf = process.env.DRIVE_PDF;

let driveClient;
// Asegurarse de que la carpeta logs exista
const logDir = 'logs';
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

// Configuración de Bottleneck
const limiter = new Bottleneck({
    minTime: 110, // Añadir un retardo mínimo de 110 ms entre solicitudes
});

// Función para generar un nombre de archivo con la fecha y hora actual
function generateLogFileName(baseName) {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    return path.join(logDir, `${baseName}_${timestamp}.log`);
}

// Configuración de Winston para los registros
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: generateLogFileName('Registros') }),
        new winston.transports.File({ filename: generateLogFileName('Errores'), level: 'error'})
    ],
});

async function initializeDriveClient(auth) {
    if (!driveClient) {
        driveClient = google.drive({ version: 'v3', auth });
        logger.info('Cliente de Google Drive inicializado');
    }
    return driveClient;
}

// Crear una carpeta en Google Drive
async function createFolder(drive, folderName, parentFolderId) {
    try{
        const fileMetadata = {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentFolderId],
        };
    
        const folder = await drive.files.create({
            resource: fileMetadata,
            fields: 'id',
        });
        `'${drive_sheets}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`
        logger.info(`Carpeta ${folderName} creada`);
    
        return folder.data.id; // Retornar el ID de la carpeta creada

    }catch(error){
        logger.error("Error al crear carpetas de spreadsheets: ", error);
    }
    
}

// Obtener la lista de hojas de un spreadsheet
async function getSpreadsheetSheets(auth, fileId, fileName) {
    try{
        const sheetsAPI = google.sheets({ version: 'v4', auth });
        const response = await sheetsAPI.spreadsheets.get({
            spreadsheetId: fileId,
        });

        const sheets = response.data.sheets;

        logger.info(`Se obtuvo las hojas del archivo ${fileName}`);
        return sheets.map(sheet => ({
            title: sheet.properties.title, //retorna el título de la hoja
            gid: sheet.properties.sheetId // retorna el id de la hoja
        })); // Retorna una lista de nombres de hojas

    }catch(error){
        logger.error("Error al obtener las hojas del spreadsheets: ", error);
    }
    
}

// Ruta para iniciar el proceso de autenticación
app.get("/auth/google", (req, res) => {
    const authUrl = getAuthUrl();
    res.redirect(authUrl);
});

// Ruta para manejar el callback de OAuth2
app.get("/google/redirect", async (req, res) => {
    const code = req.query.code;
    if (code) {
        try {
            await handleOAuthCallback(code);
            res.send("Autenticacion exitosa! Puedes cerrar esta ventana.");
        } catch (error) {
            logger.error("Error al recuperar el token de acceso", error);
            res.send("Error al recuperar el token de acceso");
        }
    } else {
        logger.info("No se proporcionó un codigo de acceso");
        res.send("No se proporcionó un codigo de acceso");  
    }
});

async function listFiles(auth) {
    try {
        //Inicializar cliente de Google Drive
        const drive = await initializeDriveClient(auth);
        // Llamada a la API para listar archivos
        const response = await drive.files.list({
            q:`'${drive_sheets}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`, // carpeta sheets
            pageSize: 30, // Número de archivos que deseas listar (puedes ajustar esto)
            fields: "files(id, name)", // Campos que deseas obtener de cada archivo
        });

        // Extraer la lista de archivos de la respuesta
        const files = response.data.files;

        // Comprobar si se encontraron archivos
        if (files.length === 0) {
            logger.info("No se encontraron archivos.");
            return [];
        } else {
            logger.info(`Archivos SpreadSheets a procesar: ${files.length}`);
            files.forEach((file) => {
                logger.info(`ID: ${file.id}, Nombre: ${file.name}`);
            });
            return files; // Devuelve la lista de archivos
        }
    } catch (error) {
        logger.error("Error al listar archivos de Google Drive:", error);
        throw error;
    }
}

// Convertir cada hoja de un spreadsheet a PDF y guardarla en la carpeta correspondiente
async function convertSheetToPDF(auth, fileId, sheetName, folderId, sheetGid, fileName) {
    try {
        const drive = await initializeDriveClient(auth);

        // Construir la URL para exportar solo la hoja específica
        const pdfExportUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export?exportFormat=pdf&format=pdf`
                            + `&gid=${sheetGid}`;
        
        var options = {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${auth.credentials.access_token}`
            }
        }

        var response = await fetch(pdfExportUrl, options);

        var pdfStream = response.body;
        
        // Crear los metadatos del archivo PDF
        const pdfFileMetadata = {
            name: `${sheetName}.pdf`,
            parents: [folderId], // Guardar en la carpeta recién creada
        };

        const media = {
            mimeType: 'application/pdf',
            body: pdfStream,
        };

        //inicializar variables para validación de generación del PDF
        let pdfFile;
        let pdfSize;
        const minSize = 10 * 1024; // 10 KB

        //intentar crear el PDF hasta que se genere correctamente
        do{
            pdfFile = await limiter.schedule(()=>drive.files.create({ //agrega el limite de solicitudes
                resource: pdfFileMetadata,
                media: media,
                fields: 'id, size',
            }));

            pdfSize = parseInt(pdfFile.data.size, 10);

            if (pdfSize < minSize) {
                logger.info(`Reintentando convertir la Hoja ${sheetName} del archivo ${fileName}...`);
                // Eliminar el archivo PDF si es menor a 10 KB, agregar limite de solicitudes
                await limiter.schedule(()=>drive.files.delete({ fileId: pdfFile.data.id })); 
                // Volver a crear el cuerpo del PDF
                pdfStream = await fetch(pdfExportUrl, options);
                media.body = pdfStream.body;
            }

        }while (pdfSize < minSize);        

        logger.info(`Hoja ${sheetName} del archivo ${fileName} convertida a PDF`);
    } catch (error) {
        logger.error(`Error al convertir la hoja ${sheetName} del archivo ${fileName}:`, error);
    }
}

// Proceso completo de conversión de spreadsheets y hojas
async function processSpreadsheets(auth) {
    const driveClient = await initializeDriveClient(auth);
    const files = await listFiles(auth);

    const startTime = process.hrtime(); // Marca de tiempo inicial

    try{
         //Procesamiento paralelo
        const conversionPromises = files.map(async (file) => {
            const folderId = await createFolder(driveClient, file.name, drive_pdf); // Crear carpeta para cada spreadsheet
            const sheets = await getSpreadsheetSheets(auth, file.id, file.name); // Obtener las hojas del spreadsheet

            const sheetConversionPromises = sheets.map(sheet =>
                convertSheetToPDF(auth, file.id, sheet.title, folderId, sheet.gid, file.name)
            );

            // Ejecutar la conversión de las hojas en paralelo
            await Promise.all(sheetConversionPromises);
        });

    // Esperar a que todos los spreadsheets sean procesados
    await Promise.all(conversionPromises);

    const endTime = process.hrtime(startTime); // Marca de tiempo final
    const elapsedTime = endTime[0] + endTime[1] / 1e9; // Tiempo en segundos
    logger.info(`Tiempo total de ejecución del programa: ${elapsedTime.toFixed(2)} segundos`);

    }catch(error){
        logger.error("Error al procesar spreadsheets: ", error);
    }
}

// Iniciar el servidor
app.listen(PORT,async () => {
    logger.info(`Server ejecutandose en el puerto ${PORT}`);

    // Autenticarse
    const auth = await loadSavedCredentials();

    if(auth){
        await processSpreadsheets(auth); // Iniciar el procesamiento
    }else{
        logger.info("Necesitas autenticarte primero");
    }
    
});
