import puppeteer from "puppeteer";
import { createReadStream, existsSync } from "fs";
import { parse } from "csv";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import { mkdirpSync } from "mkdirp";
import { join as pathJoin, basename, extname } from "path";
const args = yargs(hideBin(process.argv))
  .option("output-directory", { alias: "o", default: "output" })
  .option("file", { alias: "f" })
  .demandOption(["file"])
  .parse();

if (!existsSync(args.file)) {
  console.error(`File ${args.file} is not readable`);
  process.exit(1);
}

const outputDirectory = pathJoin(
  args["output-directory"],
  basename(args.file, extname(args.file))
);

mkdirpSync(outputDirectory);

const parser = createReadStream(args.file).pipe(parse({ columns: true }));
const browser = await puppeteer.launch({
  headless: "new",
});
for await (const entry of parser) {
  const outFilename = pathJoin(outputDirectory, `${entry.BroadLogId}.pdf`);
  if (!existsSync(outFilename)) {
    await pdfPage(browser, entry.MirrorPageUrl, outFilename);
  }
}
await browser.close();

async function pdfPage(browser, url, pdfFilename) {
  let lastError = null;
  for (let i = 0; i < 5; i++) {
    try {
      const page = await browser.newPage();

      page.setRequestInterception(true);
      page.on("request", (request) => {
        // Abort skip tracking images
        if (
          request.resourceType() === "image" &&
          request.url().indexOf("https://t.email.velliv.dk/r/?id") >= 0
        ) {
          request.abort();
          return;
        }
        request.continue();
      });

      const response = await page.goto(url, {
        waitUntil: "networkidle2",
      });

      if (!response.ok()) {
        console.warn(`[HTTP ${response.status()}] ${url}`);
      } else {
        let height = await page.evaluate(
          () => document.documentElement.offsetHeight
        );
        await page.pdf({
          path: pdfFilename,
          printBackground: true,
          height: height,
          margin: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
          },
        });
      }

      await page.close();
      return;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}
