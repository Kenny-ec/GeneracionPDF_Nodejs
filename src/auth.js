// auth.js
import { google } from "googleapis";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();
let oauth2Client;

const token_path = process.env.TOKEN_PATH;
const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;
const redirect_uri = process.env.REDIRECT_URI;
const credential_path = process.env.CREDENTIAL_PATH;

function initializeOAuth2Client() {
    const credentials = JSON.parse(fs.readFileSync(credential_path, 'utf8'));
  
    oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uri
    );
  }

const SCOPES = ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/spreadsheets"];

function getAuthUrl() {
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    include_granted_scopes: true
  });
}

async function handleOAuthCallback(code) {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    fs.writeFileSync(token_path, JSON.stringify(tokens));
    console.log("Tokens guardado en tokens.json");
    return tokens;
}

async function loadSavedCredentials() {
    try {
        const creds = fs.readFileSync(token_path);
        oauth2Client.setCredentials(JSON.parse(creds));
        console.log("Credenciales cargadas desde tokens.json");

        return oauth2Client;
    } catch (err) {
        console.log("No se encontraron las credenciales");
    }
}

// Inicializar el cliente OAuth2 al cargar el módulo
initializeOAuth2Client();
export { oauth2Client, getAuthUrl, handleOAuthCallback, loadSavedCredentials };
