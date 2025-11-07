/**
 * migrateExistingFiles.js
 *
 * One-time script to move files from SOURCE_BUCKET to DEST_BUCKET
 * based on entries in Google Sheet (Sheet2).
 */

const { S3Client, CopyObjectCommand, DeleteObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { google } = require("googleapis");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");

// --- 🔧 CONFIGURATION ---
const REGION = process.env.AWS_REGION;
const SOURCE_BUCKET = process.env.BUCKET_NAME;
const DEST_BUCKET = process.env.SUBMISSION_BUCKET;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = "Sheet2";

// Path to downloaded Google Service Account JSON
const GOOGLE_CREDENTIALS_PATH = "./google-credentials.json";

const s3 = new S3Client({ region: REGION });

async function getGoogleSheetsClient() {
  const credentials = JSON.parse(fs.readFileSync(GOOGLE_CREDENTIALS_PATH, "utf8"));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function moveFilesForRow(sheets, rowIndex, rowData) {
  try {
    // Adjust indexes based on your sheet’s column structure
    const fullName = rowData[0];
    const teamName = rowData[1];
    const uploadedFilesCell = rowData[9]; // 10th column holds uploadedFiles (based on your lambda)

    if (!uploadedFilesCell || uploadedFilesCell.startsWith("s3://")) {
      console.log(`Skipping row ${rowIndex + 1}: already migrated or empty.`);
      return;
    }

    // Parse filenames
    const files = uploadedFilesCell
      .split(";")
      .map((f) => f.trim())
      .filter(Boolean);

    if (files.length === 0) {
      console.log(`Skipping row ${rowIndex + 1}: no files listed.`);
      return;
    }

    const folderName = `${teamName || "submission"}-${uuidv4()}`.replace(/\s+/g, "_");
    console.log(`\nRow ${rowIndex + 1}: Moving ${files.length} files to folder ${folderName}/`);

    // Ensure folder marker exists
    await s3.send(
      new PutObjectCommand({
        Bucket: DEST_BUCKET,
        Key: `${folderName}/`,
      })
    );

    // Move files
    for (const fileKey of files) {
      const destKey = `${folderName}/${fileKey}`;
      console.log(`  📦 Moving: ${fileKey} → ${destKey}`);

      // Copy
      await s3.send(
        new CopyObjectCommand({
          Bucket: DEST_BUCKET,
          CopySource: `${SOURCE_BUCKET}/${fileKey}`,
          Key: destKey,
        })
      );

      // Delete (optional)
      await s3.send(
        new DeleteObjectCommand({
          Bucket: SOURCE_BUCKET,
          Key: fileKey,
        })
      );
    }

    // Update sheet with folder path
    const newFolderPath = `s3://${DEST_BUCKET}/${folderName}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!J${rowIndex + 1}`, // column J (10th)
      valueInputOption: "RAW",
      requestBody: { values: [[newFolderPath]] },
    });

    console.log(`✅ Row ${rowIndex + 1}: Updated Google Sheet with ${newFolderPath}`);
  } catch (err) {
    console.error(`❌ Error on row ${rowIndex + 1}:`, err);
  }
}

// --- 🚀 Main Script ---
(async () => {
  try {
    const sheets = await getGoogleSheetsClient();

    // Fetch all rows from Sheet2
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:K`, // Adjust if your sheet has more columns
    });

    const rows = res.data.values || [];
    console.log(`Found ${rows.length - 1} data rows.`);

    // Skip header (row 0)
    for (let i = 1; i < rows.length; i++) {
      await moveFilesForRow(sheets, i, rows[i]);
    }

    console.log("\n🎉 Migration complete!");
  } catch (err) {
    console.error("🚨 Fatal error:", err);
  }
})();
