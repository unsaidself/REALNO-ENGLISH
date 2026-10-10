import { readFile, writeFile, mkdir, rm, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Use the complete, matching English and Russian data shipped by speak.js.
// curl preserves the executor's proxy/CA settings; runtime speech uses no URL.
const run = promisify(execFile);
const revision = '9c6f642f7d78bab51d16b2e8b79cdf205643ec35';
const base = `https://raw.githubusercontent.com/kripken/speak.js/${revision}/`;
const files = {
  'speakGenerator.js': 'd83ce9905647988e7496fed48f897564cab264580c77de4d3191cb794dd29898',
  'espeak-data/ru_dict': 'b89da35574020da761fbae7ff45e6b3f5e09e8764e576b5cb2c3da8166520630',
  'espeak-data/voices/ru': 'ac2e877fc263c8fb1b929a6e1a38391d6bf3d8de37859fad3945b67d873d32dd',
  'espeak-data/voices/en/en': 'abd465a688d62c00f8fa298183d4e2948e9abbac4efd447f937618bb9c4d16a4',
  'License.txt': '0bbca7a0ad5da4a6b0677f90d17817984edce7e42d300cae94ae93e4ccba9df7',
};
const sourceDirectory = process.argv[2];
const assets = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, checksum]) => {
  const data = sourceDirectory
    ? await readFile(pathToFileURL(resolve(sourceDirectory, name)))
    : (await run('curl', ['--fail', '--silent', '--show-error', '--location', base + name], { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 })).stdout;
  if (createHash('sha256').update(data).digest('hex') !== checksum) throw new Error(`Speech source checksum mismatch: ${name}`);
  return [name, data];
})));
const directory = new URL('../src/voice/', import.meta.url);
await mkdir(directory, { recursive: true });
const marker = 'Ov.write=!0;var Lv=!1';
const generator = assets['speakGenerator.js'].toString('utf8');
if (generator.split(marker).length !== 2) throw new Error('Unexpected speak.js filesystem layout: review the adapter before updating.');
const russianFiles = `Tv('/espeak/espeak-data','ru_dict',${JSON.stringify([...assets['espeak-data/ru_dict']])},!0,!1);Tv('/espeak/espeak-data/voices','ru',${JSON.stringify([...assets['espeak-data/voices/ru']])},!0,!1);`;
const prelude = `/* speak.js / eSpeak, GNU GPL version 3. See LICENSE and NOTICE.\n * Browser worker adapter: bind legacy globals and install the complete\n * matching Russian dictionary/voice supplied by the pinned upstream. */\nconst process = undefined, window = undefined;\nlet print, printErr, read, load;\n`;
const britishVoice = `Tv('/espeak/espeak-data/voices/en','en',${JSON.stringify([...assets['espeak-data/voices/en/en']])},!0,!1);`;
const browser = prelude + generator.replace(marker, russianFiles + britishVoice + marker) + '\nexport { generateSpeech };\n';
async function writeAsset(name, content) {
  const temporary = new URL(`.${name}.${process.pid}.tmp`, directory);
  await writeFile(temporary, content);
  await rename(temporary, new URL(name, directory));
}
await writeAsset('speak-browser.js', browser);
await writeAsset('LICENSE', assets['License.txt']);
// These are previous generated engine assets, replaced by the compact adapter.
await rm(new URL('espeak-browser.js', directory), { force: true });
await rm(new URL('espeak-data.deflate.b64', directory), { force: true });
console.log(`Local speech adapter: ${Buffer.byteLength(browser)} bytes; full English and Russian data included, no runtime downloads.`);
