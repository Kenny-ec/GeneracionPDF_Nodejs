// main.js
import express from "express";
import dotenv from "dotenv";
import { google } from "googleapis";
import { PassThrough } from 'stream';
import { Readable } from 'stream';

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

async function initializeDriveClient(auth) {
    if (!driveClient) {
        driveClient = google.drive({ version: 'v3', auth });
        console.log('Cliente de Google Drive inicializado');
    }
    return driveClient;
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
        console.error("Error al recuperar el token de acceso", error);
        res.send("Error al recuperar el token de acceso");
    }
    } else {
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
            console.log("No se encontraron archivos.");
            return [];
        } else {
            console.log("Archivos encontrados:");
            files.forEach((file) => {
                console.log(`ID: ${file.id}, Nombre: ${file.name}`);
            });
            return files; // Devuelve la lista de archivos
        }
    } catch (error) {
        console.error("Error al listar archivos de Google Drive:", error);
        throw error;
    }
}
async function convertSpreadsheetToPDF(auth, fileId, fileName) {
    try {
        const drive = await initializeDriveClient(auth);

        // Descargar el archivo como PDF
        const response = await drive.files.export(
            { 
                fileId: fileId, 
                mimeType: 'application/pdf' 
            },
            { responseType: 'stream' }
        );

        const pdfStream = response.data;

        // Preparar los metadatos para crear el nuevo archivo PDF en Google Drive
        const pdfFileMetadata = {
            name: `${fileName}.pdf`, // Nombre del archivo PDF
            parents: [drive_pdf] // ID de la carpeta destino en Google Drive
        };

        // Usar PassThrough para el stream de subida
        const passThroughStream = new PassThrough();
        pdfStream.pipe(passThroughStream);

        const media = {
            mimeType: 'application/pdf',
            body: passThroughStream // Usar stream
        };

        // Subir el archivo PDF a Google Drive
        const pdfUploaded = await drive.files.create({
            resource: pdfFileMetadata,
            media: media,
            fields: 'id'
        });

        console.log(`Archivo convertido y guardado en la carpeta PDF`);

    } catch (error) {
        console.error(`Error al convertir y guardar el archivo PDF: ${fileName}`, error);
    }
}

// Iniciar el servidor
app.listen(PORT,async () => {
    console.log(`Server ejecutandose en el puerto ${PORT}`);

    // Autenticarse
    const auth = await loadSavedCredentials();

    if(auth){
        const startTime = process.hrtime(); // Marca de tiempo inicial
        const files = await listFiles(auth);

        // Crear un array de promesas para la conversión de archivos
        const conversionPromises = files.map(file => convertSpreadsheetToPDF(auth, file.id, file.name));

        // Ejecutar todas las conversiones en paralelo
        await Promise.all(conversionPromises);

        //ejecutar en serie
        /*for (const file of files) {
            await convertSpreadsheetToPDF(auth, file.id, file.name);
        }*/
        const endTime = process.hrtime(startTime); // Marca de tiempo final
        const elapsedTime = endTime[0] + endTime[1] / 1e9; // Calcular tiempo en segundos

        console.log(`Tiempo de ejecución: ${elapsedTime.toFixed(2)} segundos`);
    }else{
        console.log("Necesitas autenticarte primero");
    }
    
});
