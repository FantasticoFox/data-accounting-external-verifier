#!/usr/bin/env node

import * as main from "./index.js"
import minimist from "minimist"
import * as formatter from "./formatter.js"
import * as transformer from "./transform.js"
import * as fs from "fs"
import fetch from "node-fetch"

const opts = {
  // This is required so that -v and -m are position independent.
  boolean: ["v", "m"],
}
const argv = minimist(process.argv.slice(2), opts)

function usage() {
  console.log(`Usage:
verify.js [OPTIONS] <page title>
or
verify.js [OPTIONS] --file <offline file.json or file.xml>

Options:
  -v                     Verbose
  --server               <The url of the server, e.g. https://pkc.inblock.io>
  --ignore-merkle-proof  Ignore verifying the witness merkle proof of each revision
  --file                 (If present) The file to read from for the data
If the --server is not specified, it defaults to http://localhost:9352`)
}

// This should be a commandline argument for specifying the title of the page
// which should be verified.
if (!argv.file && argv._.length < 1) {
  formatter.log_red("ERROR: You must specify the page title")
  usage()
  process.exit(1)
}
const title = argv._[0]

const verbose = argv.v

const ignoreMerkleProof = argv["ignore-merkle-proof"] ?? false

const server = argv.server ?? "http://localhost:9352"

// For offline JSON file verification
const file = argv.file

async function readExportFile(filename) {
   if (!fs.existsSync(filename)) {
     formatter.log_red(`ERROR: The file ${filename} does not exist.`)
     process.exit(1)
   }
  const fileContent = fs.readFileSync(filename)
  let offlineData
  if (filename.endsWith(".json")) {
    const parsed = JSON.parse(fileContent)
    if (!("pages" in parsed)) {
      formatter.log_red("The json file doesn't contain 'pages' key.")
      process.exit(1)
    }
    offlineData = parsed.pages
  } else {
    if (!filename.endsWith(".xml")) {
      formatter.log_red("Only JSON or XML files are supported.")
      process.exit(1)
    }
    offlineData = await transformer.parseMWXmlString(fileContent)
  }
  return offlineData
}

async function readFromMediaWikiAPI(server, title) {
  let response, data
  response = await fetch(
    `${server}/rest.php/data_accounting/get_page_last_rev?page_title=${title}`,
  )
  data = await response.json()
  if (!response.ok) {
    formatter.log_red(`Error: get_page_last_rev: ${data.message}`)
  }
  const verificationHash = data.verification_hash
  response = await fetch(
    `${server}/rest.php/data_accounting/get_branch/${verificationHash}`
  )
  data = await response.json()
  const hashes = data.hashes
  const revisions = {}
  for (const vh of hashes) {
    response = await fetch(
      `${server}/rest.php/data_accounting/get_revision/${vh}`
    )
    revisions[vh] = await response.json()
  }
  return revisions
}

// The main function
(async function () {
  let input
  if (file) {
    const offlineData = await readExportFile(file)
    for (const offlinePageData of offlineData) {
      console.log(`Verifying ${offlinePageData.title}`)
      input = { offline_data: offlinePageData }
      await main.verifyPageCLI(input, verbose, !ignoreMerkleProof)
      console.log()
    }
  } else {
    console.log(`Verifying ${title}`)
    const revisions = await readFromMediaWikiAPI(server, title)
    const exported = {
      revisions
    }
    input = { offline_data: exported}
    await main.verifyPageCLI(input, verbose, !ignoreMerkleProof)
  }
})()
