#!/usr/bin/env node

import * as fs from "fs"
import { randomBytes } from "crypto"

import * as ethers from "ethers"
import minimist from "minimist"
import * as http from "http"
import { MerkleTree } from "merkletreejs"

import * as main from "./index.js"
import * as formatter from "./formatter.js"

import * as did from "./did.js"
// Witness support for nostr network
import * as witnessNostr from "./witness_nostr.js"
import * as witnessEth from "./witness_eth.js"
import * as witnessTsa from "./witness_tsa.js"

import { fileURLToPath } from "url"
import { dirname } from "path"

// import { Wallet, Mnemonic } from 'ethers';
import { readCredentials, getWallet, estimateWitnessGas } from "./utils.js"

const opts = {
  // This is required so that -v is position independent.
  boolean: ["v", "scalar", "content", "rm"],
  string: ["sign", "link", "witness"],
}

const usage = () => {
  console.log(`Usage:
notarize.js [OPTIONS] <filename>
which generates filename.aqua.json

Options:
  --sign [cli|metamask|did]
    Sign with either of:
    1. the Ethereum seed phrase provided in mnemonic.txt
    2. MetaMask
    3. DID key
  --witness [eth|nostr|tsa]
    Witness with either of:
    1. Ethereum on-chain with MetaMask
    2. Nostr network
    3. TSA DigiCert
  --link <filename.aqua.json>
    Add a link to an AQUA chain as a dependency
  --scalar
    Use this flag to use a more lightweight, "scalar" aquafication.
    This is the default option.
  --content
    Use this flag to include the content file instead of just its hash and name
  --rm
    Remove the most recent revision of the AQUA file
  --form
    Use this flag to include the json file with form data
  --network
    Use this flag to switch between 'mainnet' and 'sepolia' when witnessing
  --type 
    Use this flag to switch between metamask and cli wallet when witnessing 
`)
}

const argv = minimist(process.argv.slice(2), opts)
const filename = argv._[0]

if (!filename) {
  formatter.log_red("ERROR: You must specify a file")
  usage()
  process.exit(1)
}

const signMethod = argv["sign"]
const enableSignature = !!signMethod
// all revisions are scalar by default other than the forms revisions
// to reduce comput cost and time
let enableScalar = argv["scalar"]
let vTree = argv["vtree"]
const witnessMethod = argv["witness"]
const enableWitness = !!witnessMethod
const enableContent = argv["content"]
const enableRemoveRevision = argv["rm"]
const linkURIs = argv["link"]
const enableLink = !!linkURIs
const form_file_name = argv["form"]
const network = argv["network"]
const witness_platform_type = argv["type"]

const port = 8420
const host = "localhost"
const serverUrl = `http://${host}:${port}`

const doSign = async (wallet, verificationHash) => {
  const message = "I sign this revision: [" + verificationHash + "]"
  const signature = await wallet.signMessage(message)
  return signature
}

const signMetamaskHtml = `
<html>
  <script>
const message = "MESSAGETOBESIGNED";
const localServerUrl= window.location.href;
const doSignProcess = async () => {
  const wallet_address = window.ethereum.selectedAddress
  const signature = await window.ethereum.request({
    method: 'personal_sign',
    params: [message, window.ethereum.selectedAddress],
  })
  document.getElementById("signature").innerHTML = \`Signature of your file: \${signature} (you may close this tab)\`
  await fetch(localServerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({signature, wallet_address})
  })
}
if (window.ethereum && window.ethereum.isMetaMask) {
  if (window.ethereum.isConnected() && window.ethereum.selectedAddress) {
    doSignProcess()
  } else {
    window.ethereum.request({ method: 'eth_requestAccounts' })
      .then(doSignProcess)
      .catch((error) => {
        console.error(error);
        alert(error.message);
      })
  }
} else {
  alert("Metamask not detected")
}
  </script>
<body>
    <div id="signature"></div>
</body>
</html>
`

const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const doSignMetamask = async (verificationHash) => {
  const maxAttempts = 24 // 2 minute timeout (12 * 5 seconds)
  let attempts = 0

  const messageToBeSigned = "I sign this revision: [" + verificationHash + "]"
  const html = signMetamaskHtml.replace("MESSAGETOBESIGNED", messageToBeSigned)
  const requestListener = witnessEth.commonPrepareListener(html)
  const server = http.createServer(requestListener)
  try {
    server.listen(port, host, () => {
      console.log(`Server is running on ${serverUrl}`)
    })
    let response, content
    while (attempts < maxAttempts) {
      response = await fetch(serverUrl + "/result")
      content = await response.json()
      if (content.signature) {
        const signature = content.signature
        const walletAddress = content.wallet_address
        const publicKey = ethers.SigningKey.recoverPublicKey(
          ethers.hashMessage(messageToBeSigned),
          signature,
        )
        console.log(`The signature has been retrieved: ${signature}`)
        server.close()
        return [signature, walletAddress, publicKey]
      }
      console.log("Waiting for the signature...")
      attempts++
      await sleep(5000)
    }

    console.error("Signature timeout: No response from MetaMask")
    server.close()
    process.exit(1)
  } catch (error) {
    server.close()
    throw error
  }
}

const prepareNonce = () => {
  return randomBytes(32).toString("base64url")
}

const createRevisionWithMultipleAquaChain = async (timestamp, revisionType) => {
  if (!filename.includes(",")) {
    console.error("Multiple files must be separated by commas")
    process.exit(1)
  }

  // read files
  let all_aqua_files = filename.split(",")

  let all_file_aqua_objects = []
  for (const file of all_aqua_files) {
    const filePath = `${file}.aqua.json`

    if (!fs.existsSync(filePath)) {
      console.error(`File does not exist: ${filePath}`)
      process.exit(1)
    }

    try {
      const fileContent = fs.readFileSync(filePath, "utf-8")
      const aquaObject = JSON.parse(fileContent)
      console.log(`Successfully read: ${filePath}`)
      all_file_aqua_objects.push(aquaObject)
    } catch (error) {
      console.error(`Error reading ${filePath}:`, error)
      process.exit(1)
    }
  }
  console.log("All files read successfully \n", all_file_aqua_objects)
  // get the last verification hash
  let lastRevionHashes = []

  for (const file of all_file_aqua_objects) {
    const verificationHashes = Object.keys(file.revisions)
    lastRevionHashes.push(verificationHashes[verificationHashes.length - 1])
  }
  console.log("All last revision hashes  \n", lastRevionHashes)

  const tree2 = new MerkleTree(lastRevionHashes, main.getHashSum, {
    duplicateOdd: false,
  })

  let merkleRoot = tree2.getHexRoot()
  let merkleProofArray = []

  lastRevionHashes.forEach((hash) => {
    let merkleProof = tree2.getHexProof(hash)
    merkleProofArray.push(merkleProof)
  })

  console.log("Merkle proof: ", merkleProofArray)

  let witnessResult = await prepareWitness(merkleRoot)

  witnessResult.witness_merkle_proof = lastRevionHashes

  for (let index = 0; index < all_aqua_files.length; index++) {
    const current_file = all_aqua_files[index]
    const current_file_aqua_object = all_file_aqua_objects[index]

    // let previousVerificationHash = current_file_aqua_object.revisions.keys.pop();
    const revisionKeys = Object.keys(current_file_aqua_object.revisions)
    const latestRevisionKey = revisionKeys.pop() // Get the last key

    console.log("Latest revision key:", latestRevisionKey)

    let verificationData = {
      previous_verification_hash: latestRevisionKey,
      local_timestamp: timestamp,
      revision_type: revisionType,
      ...witnessResult,
    }

    // if (enableScalar) {
    //   // A simpler version of revision -- scalar
    //   const scalarData = verificationData //JSON.stringify(verificationData)
    //   return {
    //     verification_hash:
    //       "0x" + main.getHashSum(JSON.stringify(verificationData)),
    //     data: scalarData,
    //   }
    // }

    const revisions = current_file_aqua_object.revisions

    // Merklelize the dictionary
    const leaves = main.dict2Leaves(verificationData)
    const tree = new MerkleTree(leaves, main.getHashSum, {
      duplicateOdd: false,
    })

    verificationData.leaves = leaves
    const verificationHash = tree.getHexRoot()
    revisions[verificationHash] = verificationData
    console.log(
      `\n\n Writing new revision ${verificationHash} to ${current_file} current file current_file_aqua_object ${JSON.stringify(current_file_aqua_object)} \n\n `,
    )
    maybeUpdateFileIndex(
      current_file_aqua_object,
      {
        verification_hash: verificationHash,
        data: verificationData,
      },
      revisionType,
    )
    const filePath = `${current_file}.aqua.json`
    serializeAquaObject(filePath, current_file_aqua_object)
  }
  return true
}

const prepareWitness = async (verificationHash) => {
  if (!witnessMethod) {
    console.error("Witness method must be specified")
    process.exit(1)
  }

  const merkle_root = verificationHash
  let witness_network,
    smart_contract_address,
    transactionHash,
    publisher,
    witnessTimestamp

  switch (witnessMethod) {
    case "nostr":
      // publisher is a public key used for nostr
      // transaction hash is an event identifier for nostr
      ;[transactionHash, publisher, witnessTimestamp] =
        await witnessNostr.witness(merkle_root)
      witness_network = "nostr"
      smart_contract_address = "N/A"
      break
    case "tsa":
      const tsaUrl = "http://timestamp.digicert.com" // DigiCert's TSA URL
      ;[transactionHash, publisher, witnessTimestamp] =
        await witnessTsa.witness(merkle_root, tsaUrl)
      witness_network = "TSA_RFC3161"
      smart_contract_address = tsaUrl
      break
    case "eth":
      let useNetwork = "sepolia"
      if (network === "mainnet") {
        useNetwork = "mainnet"
      }
      witness_network = useNetwork
      smart_contract_address = "0x45f59310ADD88E6d23ca58A0Fa7A55BEE6d2a611"

      if (witness_platform_type === "cli") {
        let creds = readCredentials()
        let [wallet, walletAddress, publicKey] = getWallet(creds.mnemonic)

        console.log("Wallet address: ", walletAddress)

        let gasEstimateResult = await estimateWitnessGas(
          walletAddress,
          merkle_root,
          witness_network,
          smart_contract_address,
          null,
        )

        console.log("Gas estimate result: ", gasEstimateResult)

        if (gasEstimateResult.error !== null) {
          console.log(`Unable to Estimate gas fee: ${gasEstimateResult?.error}`)
          process.exit(1)
        }

        if (!gasEstimateResult.hasEnoughBalance) {
          console.log(`You do not have enough balance to cater for gas fees`)
          console.log(
            `Add some faucets to this wallet address: ${walletAddress}\n`,
          )
          process.exit(1)
        }

        // = async (walletPrivateKey, witness_event_verification_hash, smart_contract_address, providerUrl)
        let witnessCliResult = await witnessEth.witnessCli(
          wallet.privateKey,
          merkle_root,
          smart_contract_address,
          witness_network,
          null,
        )

        console.log("cli signing result: ", witnessCliResult)

        if (witnessCliResult.error !== null) {
          console.log(`Unable to witnesss: ${witnessCliResult.error}`)
          process.exit(1)
        }

        transactionHash = witnessCliResult.transactionHash
        publisher = walletAddress
      } else {
        ;[transactionHash, publisher] = await witnessEth.witnessMetamask(
          merkle_root,
          witness_network,
          smart_contract_address,
        )
      }

      witnessTimestamp = Math.floor(Date.now() / 1000)
      break
    default:
      console.error(`Unknown witness method: ${witnessMethod}`)
      process.exit(1)
  }
  const witness = {
    witness_merkle_root: merkle_root,
    witness_timestamp: witnessTimestamp,
    // Where is it stored: ChainID for ethereum, btc, nostr
    witness_network,
    // Required for the the publishing of the hash
    witness_smart_contract_address: smart_contract_address,
    // Transaction hash to locate the verification hash
    witness_transaction_hash: transactionHash,
    // Publisher / Identifier for publisher
    witness_sender_account_address: publisher,
    // Optional for aggregated witness hashes
    witness_merkle_proof: [
      verificationHash,
      // {
      //   depth: "0",
      //   left_leaf: verificationHash,
      //   right_leaf: null,
      //   successor: merkle_root,
      // },
    ],
  }
  return witness
}

const createNewAquaObject = () => {
  return { revisions: {}, file_index: {} }
}

function formatMwTimestamp(ts) {
  // Format timestamp into the timestamp format found in Mediawiki outputs
  return ts
    .replace(/-/g, "")
    .replace(/:/g, "")
    .replace("T", "")
    .replace("Z", "")
}

const getFileTimestamp = (filename) => {
  const fileStat = fs.statSync(filename)
  // Last modified time
  const mtime = JSON.stringify(fileStat.mtime)
  const timestamp = formatMwTimestamp(mtime.slice(1, mtime.indexOf(".")))
  return timestamp
}

const prepareSignature = async (previousVerificationHash) => {
  let signature, walletAddress, publicKey, signature_type
  switch (signMethod) {
    case "metamask":
      ;[signature, walletAddress, publicKey] = await doSignMetamask(
        previousVerificationHash,
      )
      signature_type = "ethereum:eip-191"
      break
    case "cli":
      try {
        const credentials = readCredentials()
        let wallet
        ;[wallet, walletAddress, publicKey] = getWallet(credentials.mnemonic)
        signature = await doSign(wallet, previousVerificationHash)
      } catch (error) {
        console.error("Failed to read mnemonic:", error)
        process.exit(1)
      }
      signature_type = "ethereum:eip-191"
      break
    case "did":
      const credentials = readCredentials()
      if (credentials["did:key"].length === 0 || !credentials["did:key"]) {
        console.log(
          "DID key is required.  Please get a key from https://hub.ebsi.eu/tools/did-generator",
        )

        process.exit(1)
      }

      const { jws, key } = await did.signature.sign(
        previousVerificationHash,
        Buffer.from(credentials["did:key"], "hex"),
      )
      signature = jws
      walletAddress = key
      publicKey = key
      signature_type = "did:key"
      break
  }
  return {
    signature,
    signature_public_key: publicKey,
    signature_wallet_address: walletAddress,
    signature_type,
  }
}

const getLatestVH = (uri) => {
  const aquaObject = JSON.parse(fs.readFileSync(uri))
  const verificationHashes = Object.keys(aquaObject.revisions)
  return verificationHashes[verificationHashes.length - 1]
}

const serializeAquaObject = (aquaFilename, aquaObject) => {
  try {
    // Convert the object to a JSON string
    const jsonString = JSON.stringify(aquaObject, null, 2)
    fs.writeFileSync(aquaFilename, jsonString, "utf8")
  } catch (error) {
    console.error("Error writing file:", error)
    process.exit(1)
  }
}

const checkFileHashAlreadyNotarized = (fileHash, aquaObject) => {
  // Check if this file hash already exists in any revision
  const existingRevision = Object.values(aquaObject.revisions).find(
    (revision) => revision.file_hash && revision.file_hash === fileHash,
  )

  if (existingRevision) {
    console.log(
      `Abort. No new revision created.\n \nA new content revision is obsolete as a content revision with the same file hash (${fileHash}) already exists. `,
    )
    process.exit(1)
  }
}

const maybeUpdateFileIndex = (aquaObject, verificationData, revisionType) => {
  const validRevisionTypes = ["file", "form", "link"]
  //if (!validRevisionTypes.includes(revisionType)) {
  //  console.error(`Invalid revision type for file index: ${revisionType}`);
  //  return;
  //}
  let verificationHash = ""

  switch (revisionType) {
    case "form":
      verificationHash = verificationData.verification_hash
      aquaObject.file_index[verificationHash] = form_file_name
      break
    case "file":
      verificationHash = verificationData.verification_hash
      aquaObject.file_index[verificationHash] = filename
      break
    case "link":
      const linkURIsArray = linkURIs.split(",")
      const linkVHs = verificationData.data.link_verification_hashes
      for (const [idx, vh] of linkVHs.entries()) {
        aquaObject.file_index[vh] = `${linkURIsArray[idx]}`
      }
  }
}

const createGenesisRevision = async (aquaFilename, timestamp) => {
  let revisionType = "file"
  if (form_file_name) {
    revisionType = "form"

    if (form_file_name != aquaFilename.replace(/\.aqua\.json$/, "")) {
      console.log(
        `First Revision  : Form file name is not the same as the aqua file name \n  Form : ${form_file_name}  File : ${aquaFilename}`,
      )
      process.exit(1)
    }
  }

  if (enableRemoveRevision) {
    // Don't serialize if you do --rm during genesis creation
    console.log("There is nothing delete.")
    return
  }

  const aquaTree = new AquaTree(null, timestamp=timestamp, revisionType=revisionType, enableScalar=enableScalar)

  console.log(
    `Writing new ${revisionType} revision ${aquaTree.lastRevisionHash} to ${filename}.aqua.json`,
  )
  serializeAquaObject(aquaFilename, aquaTree.aquaObject)
}

class AquaTree {
  constructor(aquaFilename = null, timestamp = null, revisionType = null, enableScalar = true) {
    if (aquaFilename !== null) {
      this.read(aquaFilename)
    } else if (timestamp !== null && revisionType !== null) {
      this.aquaObject = createNewAquaObject()
      this.lastRevisionHash = ""
      this.createNewRevision(timestamp, revisionType, enableScalar)
    }
  }

  read = (aquaFilename) => {
    this.aquaFilename = aquaFilename
    this.aquaObject = JSON.parse(fs.readFileSync(aquaFilename))
    const revisions = this.aquaObject.revisions
    const verificationHashes = Object.keys(revisions)
    this.lastRevisionHash = verificationHashes[verificationHashes.length - 1]
  }

  removeLastRevision = () => {
    const lastRevision = this.aquaObject.revisions[this.lastRevisionHash]
    switch (lastRevision.revision_type) {
      case "file":
        delete this.aquaObject.file_index[lastRevision.file_hash]
        break
      case "link":
        for (const vh of lastRevision.link_verification_hashes) {
          delete this.aquaObject.file_index[vh]
        }
    }

    delete this.aquaObject.revisions[lastRevisionHash]
    console.log(`Most recent revision ${lastRevisionHash} has been removed`)
    if (Object.keys(this.aquaObject.revisions).length === 0) {
      // If there are no revisions left, delete the .aqua.json file
      try {
        fs.unlinkSync(this.aquaFilename)
        console.log(
          `${this.aquaFilename} has been deleted because there are no revisions left.`,
        )
        // Since we've deleted the file, there's no need to return here; the script should end.
      } catch (err) {
        console.error(`Failed to delete ${this.aquaFilename}:`, err)
      }
    } else {
      serializeAquaObject(this.aquaFilename, this.aquaObject)
    }
  }

  createNewRevision = async (timestamp, revisionType, enableScalar) => {
    const previousVerificationHash = this.lastRevisionHash
    const validRevisionTypes = ["file", "signature", "witness", "form", "link"]
    if (!validRevisionTypes.includes(revisionType)) {
      console.error(`Invalid revision type: ${revisionType}`)
      process.exit(1)
    }

    let verificationData = {
      previous_verification_hash: previousVerificationHash,
      local_timestamp: timestamp,
      revision_type: revisionType,
    }

    let fileHash
    switch (revisionType) {
      case "file":
        const fileContent = fs.readFileSync(filename)
        fileHash = main.getHashSum(fileContent)
        checkFileHashAlreadyNotarized(fileHash, this.aquaObject)
        if (enableContent) {
          verificationData["content"] = fileContent.toString("utf8")
        }
        verificationData["file_hash"] = fileHash
        verificationData["file_nonce"] = prepareNonce()
        break
      case "signature":
        const sigData = await prepareSignature(previousVerificationHash)
        verificationData = { ...verificationData, ...sigData }
        break
      case "witness":
        const witness = await prepareWitness(previousVerificationHash)
        verificationData = { ...verificationData, ...witness }
        // verificationData.witness_merkle_proof = JSON.stringify(
        //   verificationData.witness_merkle_proof,
        // )
        break
      case "form":
        let form_data
        try {
          // Read the file
          form_data = fs.readFileSync(form_file_name)
        } catch (readError) {
          // Handle file read errors (e.g., file not found, permission issues)
          console.error(
            "Error: Unable to read the file. Ensure the file exists and is accessible.",
          )
          process.exit(1)
        }

        // Calculate the hash of the file
        fileHash = main.getHashSum(form_data)
        checkFileHashAlreadyNotarized(fileHash, this.aquaObject)
        verificationData["file_hash"] = fileHash
        verificationData["file_nonce"] = prepareNonce()

        let form_data_json
        try {
          // Attempt to parse the JSON data
          form_data_json = JSON.parse(form_data)
        } catch (parseError) {
          // Handle invalid JSON data
          console.error("Error: The file does not contain valid JSON data.")
          process.exit(1)
        }

        // Sort the keys
        let form_data_sorted_keys = Object.keys(form_data_json)
        let form_data_sorted_with_prefix = {}
        for (let key of form_data_sorted_keys) {
          form_data_sorted_with_prefix[`forms_${key}`] = form_data_json[key]
        }

        verificationData = {
          ...verificationData,
          ...form_data_sorted_with_prefix,
        }
        break

      case "link":
        const linkURIsArray = linkURIs.split(",")
        // Validation
        linkURIsArray.map((uri) => {
          if (!uri.endsWith(".aqua.json")) return
          console.error(`${uri} is an Aqua file hence not applicable`)
          process.exit(1)
        })
        const linkAquaFiles = linkURIsArray.map((e) => `${e}.aqua.json`)
        const linkVHs = linkAquaFiles.map(getLatestVH)
        const linkFileHashes = linkURIsArray.map(main.getFileHashSum)
        // Validation again
        linkFileHashes.map((fh) => {
          if (!(fh in this.aquaObject.file_index)) return
          console.error(
            `${fh} detected in file index. You are not allowed to interlink Aqua files of the same file`,
          )
          process.exit(1)
        })

        const linkData = {
          link_type: "aqua",
          link_require_indepth_verification: true,
          link_verification_hashes: linkVHs,
          link_file_hashes: linkFileHashes,
        }
        verificationData = { ...verificationData, ...linkData }
    }

    let verificationHash, out
    if (enableScalar) {
      // A simpler version of revision -- scalar
      const scalarData = verificationData //JSON.stringify(verificationData)
      verificationHash = "0x" + main.getHashSum(JSON.stringify(verificationData))
      out =  {
        verification_hash: verificationHash,
        data: scalarData,
      }
    } else {
      // Merklelize the dictionary
      const leaves = main.dict2Leaves(verificationData)
      const tree = new MerkleTree(leaves, main.getHashSum, {
        duplicateOdd: false,
      })
      verificationData.leaves = leaves
      verificationHash = tree.getHexRoot()
      out = {
        verification_hash: verificationHash,
        data: verificationData,
      }
    }

    this.lastRevisionHash = verificationHash
    this.aquaObject.revisions[this.lastRevisionHash] = verificationData
    maybeUpdateFileIndex(this.aquaObject, out, revisionType)
    return out
  }
}

// The main function
;(async function () {
  const aquaFilename = filename + ".aqua.json"
  // const timestamp = getFileTimestamp(filename)
  // We use "now" instead of the modified time of the file
  const now = new Date().toISOString()
  const timestamp = formatMwTimestamp(now.slice(0, now.indexOf(".")))
  if (!form_file_name) {
    enableScalar = true
  }
  if (vTree) {
    enableScalar = false
  }

  let revisionType = "file"
  if (enableSignature) {
    revisionType = "signature"
  } else if (enableWitness) {
    revisionType = "witness"
  } else if (enableLink) {
    revisionType = "link"
  } else if (form_file_name) {
    revisionType = "form"
    enableScalar = false
  }

  if (revisionType == "witness" && filename.includes(",")) {
    createRevisionWithMultipleAquaChain(timestamp, revisionType)
    return
  }

  if (!fs.existsSync(aquaFilename)) {
    createGenesisRevision(aquaFilename, timestamp)
    return
  }

  const aquaTree = new AquaTree(aquaFilename)

  if (enableRemoveRevision) {
    aquaTree.removeLastRevision()
    return
  }

  if (enableSignature && enableWitness) {
    formatter.log_red("ERROR: you cannot sign & witness at the same time")
    process.exit(1)
  }

  console.log("Revision type: ", revisionType)

  const verificationData = aquaTree.createNewRevision(timestamp, revisionType, enableScalar)
  const verificationHash = verificationData.verification_hash
  console.log(`Writing new revision ${verificationHash} to ${aquaFilename}`)
  serializeAquaObject(aquaFilename, aquaTree.aquaObject)
})()
