import axios from 'axios';
import AdmZip from 'adm-zip';
import { promises as fsPromises } from 'fs';
import fs from 'fs';
import path from 'path';

import { execSync } from 'child_process';


import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);


const __dirname = path.dirname(__filename);

const REPO_ROOT = path.join(__dirname, "..", "..");

const DOCS_ROOT = path.join(REPO_ROOT, "src", "content", "docs");

const downloadAndUnzip = async (downloadURL, extractPath) => {
    try {
        // Download the zip file
        const response = await axios({
            method: 'get',
            url: downloadURL,
            responseType: 'arraybuffer'
        });

        // Save the zip file to disk
        await fsPromises.writeFile(outputFilePath, response.data);

        // Unzip the file
        const zip = new AdmZip(outputFilePath);
        zip.extractAllTo(extractPath, true);

        // Delete the original zip file
        await fsPromises.unlink(outputFilePath);

        console.log('Download and extraction complete.');
    } catch (error) {
        console.error('An error occurred:', error);
    }
};

const mv =  (srcPath, dstPath) => {
    execSync(`mv ${srcPath} ${dstPath}`)
}

const mkdirp =  (dir, dstPath) => {
    execSync(`mkdir -p ${dir}`)
}

const formatBackendDocs = async() => {

    mkdirp(path.join(REPO_ROOT, "src", "assets", "images-backend"))

    const docsOrig = fs.readFileSync(
        path.join(DOCS_ROOT, "backend", "backend-documentation-main", "backend_documentation.md")
    ).toString()

    let docsText = "---\ntitle: Backend documentation\n---\n"
    docsText += docsOrig.replace(/\(images\//g, "(../../../assets/images-backend/")
    fs.writeFileSync(
        path.join(DOCS_ROOT, "backend", "index.md"),
        docsText
    );

    mv(
        path.join(DOCS_ROOT, "backend", "backend-documentation-main", "images", "*"),
        path.join(REPO_ROOT, "src", "assets", "images-backend")
    )

    await fsPromises.rm(path.join(DOCS_ROOT, "backend", "backend-documentation-main"), {force: true, recursive: true})
}

const downloadURL = 'https://github.com/ooni/backend-documentation/archive/refs/heads/main.zip';
const outputFilePath = path.join(DOCS_ROOT, "backend.zip");
const extractPath = path.join(DOCS_ROOT, "backend");

const main = async () => {
    console.log(`Downloading ${downloadURL}`)
    await downloadAndUnzip(downloadURL, extractPath);
    console.log(`Extracting into ${extractPath}`)
    await formatBackendDocs()
}

main()