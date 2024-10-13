// main.js
import express from "express";
import dotenv from "dotenv";
import { google } from "googleapis";
import {
  getAuthUrl,
  handleOAuthCallback,
  loadSavedCredentials,
} from "./auth.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

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
        
        // Verifica si se cargaron las credenciales autenticadas
        if (!auth) {
            throw new Error("No se encontraron credenciales de autenticación.");
        }
        // Crear un cliente de Google Drive
        const drive = google.drive({ version: "v3", auth });
        // Llamada a la API para listar archivos
        const response = await drive.files.list({
            pageSize: 10, // Número de archivos que deseas listar (puedes ajustar esto)
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
// Iniciar el servidor
app.listen(PORT,async () => {
    console.log(`Server ejecutandose en el puerto ${PORT}`);

    // Autenticarse
    const auth = await loadSavedCredentials();

    if(auth){
        await listFiles(auth);
    }else{
        console.log("Necesitas autenticarte primero");
    }
    
});
