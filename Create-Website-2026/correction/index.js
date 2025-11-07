const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const { google } = require("googleapis");
const secretsClient = new SecretsManagerClient();

const { S3Client } = require("@aws-sdk/client-s3");
const { v4: uuidv4 } = require("uuid");
const s3 = new S3Client({ region: process.env.AWS_REGION });


// Main Lambda handler
exports.handler = async (event) => {

  try {

      // Google Sheets auth
      const secretResponse = await secretsClient.send(
        new GetSecretValueCommand({ SecretId: "google-sheets-credentials" })
      );
      const credentials = JSON.parse(secretResponse.SecretString);
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
      const sheets = google.sheets({ version: "v4", auth });

      // Determine spreadsheetId based on formType
      const spreadsheetId = process.env.SPREADSHEET_ID;


  } catch (err) {
    console.error("Error in Lambda:", err);
  }
};