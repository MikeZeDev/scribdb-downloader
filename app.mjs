import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { createRequire } from "module";
import { calculate } from "./lib/jpg.mjs";
import pLimit from 'p-Limit';
import inquirer from 'inquirer';

main().catch(err => console.log(err.message, err.stack)).finally(() => {
    console.log('end');
});

async function main() {

    //1) Ask for document url
    const urlPrompt = await inquirer.prompt([
        {
            name: "url",
            type: "input",
            message: "Please enter document URL",
        },
    ]);
    const response = await fetch(urlPrompt.url);
    let data = await response.text();

    //2) Fetch document and gather JSONP list
    const JSONPLIST = [...data.matchAll(/contentUrl\s*:\s*["'](.*)["']/g)].map(element => element.at(1));
    //console.log(JSONPLIST);

    //3) download each JSONP
    const jpegList = await fetchJSONPandGetImageUrls(JSONPLIST);
    //console.log(jpegList);

    //4 Download all pages
    const docPrompt = await inquirer.prompt([
        {
            name: "title",
            type: "input",
            message: "Please enter document title",
        },
    ]);
    const documentTitle = sanatizePath(docPrompt.title);
    const pages = await savePages(documentTitle, jpegList);
    //console.log(pages);

    //5) gather image dimension
    const pdfSize = await getImageDimensions(pages.at(0));

    //6) compute pdf name
    const pdfname = documentTitle + '.pdf';
    const pdfpath = path.resolve('.', pdfname);

    //7: save PDF
    await savePDF(pdfpath, pages, pdfSize);

    //8 : Supression des images
    const pathToClean = path.dirname(pages.at(0));
    fs.rmSync(pathToClean, { recursive: true, force: true });
}

/**
 *  Download each JSONP file and extract the image url
 *  @param {string[]} jsonpList - url list
 *  @returns string[]
 */
async function fetchJSONPandGetImageUrls(jsonpList) {
    const limit = pLimit(3);
    let promises = jsonpList.map(page => {
        return limit(() => getJSONP(page));
    });
    const results = await Promise.all(promises);
    return results;
}

/**
 *  Download a JSONP file and extract the image url
 *  @param {string} url - self explanatory
 */
async function getJSONP(url) {
    console.log(`\r\n downloading ${url}`);
    const res = await fetch(url);
    const data = await res.text();
    return data.match(/orig\s*=\\"(.*)\\"/).at(1);
}

/**
 * Download jpeg files of the document
 * @param {string[]} jpegList - list of page urls
 * @returns string[] - list of image file path on disk
 */
async function savePages(docTitle, jpegList) {

    const dist = path.resolve('.', docTitle);
    const pages = [];
    await fs.promises.mkdir(dist, { recursive: true });

    const limit = pLimit(3);

    let promises = jpegList.map((page, index) => {
        const imagePath = path.resolve(dist, `000${index}.jpg`);
        pages.push(imagePath);
        return limit(() => downloadImage(page, imagePath));
    });

    await Promise.all(promises);
    return pages;
}


/**
 * Download ressource {url} in file {path}
 * @param {string} url - lien du fichier
 * @param {string} path - chemin de fichier
 * @returns
 */
async function downloadImage(url, path) {
    console.log(`\r\n downloading ${url}`);
    const res = await fetch(url);
    console.log(`\r\n save to ${path}`);
    fs.writeFileSync(path, new Uint8Array(await res.arrayBuffer()));
}
/**
 * clean file path & name
 * @param {string} path - chemin de fichier
 * @returns 
 */
function sanatizePath(path) {
    //replace C0 && C1 control codes
    path = path.replace(/[\u0000-\u001F\u007F-\u009F]/gu, '');

    if (process.platform.indexOf('win32') === 0) {
        // TODO: max. 260 characters per path
        path = path.replace(/[\\/:*?"<>|]/g, '');
    }
    if (process.platform.indexOf('linux') === 0) {
        path = path.replace(/[/]/g, '');
    }

    if (process.platform.indexOf('darwin') === 0) {
        // TODO: max. 32 chars per part
        path = path.replace(/[/:]/g, '');
    }
    return path.replace(/[.\s]+$/g, '').trim();
}

//****************************/
//PDF
//************************** */

/**
 * Fetch image dimensions
 * @param {string} page - Image file path
 */
async function getImageDimensions(page) {
    const data = fs.readFileSync(page);
    const size = calculate(data);
    return size;
}

/**
 * Combine jpeg files into a pdf 
 * @param {string} pdfpath - PDf path
 * @param {string[]} pages - image list
 * @param pdfsize - PDF dimensions ({height : number, width : number})
 * @returns
 */
async function savePDF(pdfpath, pages, pdfsize) {
    console.log('\r Saving pdf...');
    const require = createRequire(import.meta.url);
    const PDFDocument = require('pdfkit');

    const doc = new PDFDocument({ autoFirstPage: false });
    doc.pipe(fs.createWriteStream(pdfpath));
    for (const page of pages) {
        await addImageToPDF(doc, page, pdfsize);
    }
    doc.end();
}

/**
 * Add image to pdf
 * @param {PDFDocument} pdfDocument - pdf doc
 * @param {string} page - image path
 * @param pdfsize - PDF dimensions ({height : number, width : number})
 * @returns
 */
async function addImageToPDF(pdfDocument, page, pdfsize) {
    pdfDocument.addPage({ size: [pdfsize.width, pdfsize.height] });
    pdfDocument.image(page, 0, 0);
}
