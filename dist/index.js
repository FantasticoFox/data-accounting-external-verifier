"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  AquaVerifier: () => AquaVerifier,
  ResultStatusEnum: () => ResultStatusEnum,
  getTimestampDirect: () => getTimestampDirect,
  getTimestampSafe: () => getTimestampSafe
});
module.exports = __toCommonJS(src_exports);

// src/v1_2/models.ts
function getTimestampDirect(pageData) {
  if (pageData.pages.length > 0) {
    const firstPage = pageData.pages[0];
    const firstRevisionKey = Object.keys(firstPage.revisions)[0];
    return firstPage.revisions[firstRevisionKey].metadata.time_stamp;
  }
  return void 0;
}
function getTimestampSafe(pageData) {
  return pageData.pages[0]?.revisions[Object.keys(pageData.pages[0]?.revisions || {})[0]]?.metadata.time_stamp;
}
var ResultStatusEnum = /* @__PURE__ */ ((ResultStatusEnum2) => {
  ResultStatusEnum2[ResultStatusEnum2["MISSING"] = 0] = "MISSING";
  ResultStatusEnum2[ResultStatusEnum2["AVAILABLE"] = 1] = "AVAILABLE";
  return ResultStatusEnum2;
})(ResultStatusEnum || {});

// src/v1_2/utils.ts
var import_js_sha3 = __toESM(require("js-sha3"));
var import_ethers2 = require("ethers");

// src/v1_2/updated_check_etherscan.ts
var import_ethers = require("ethers");
var networkRpcMap = {
  mainnet: "https://eth-mainnet.g.alchemy.com/v2/",
  holesky: "https://eth-holesky.g.alchemy.com/v2/",
  sepolia: "https://eth-sepolia.g.alchemy.com/v2/"
};
async function checkTransaction(network, txHash, expectedVerificationHash, alchemyKey) {
  let result = {
    verificationHashMatches: false,
    message: "",
    successful: false
  };
  try {
    const rpcUrl = networkRpcMap[network] + alchemyKey;
    if (!rpcUrl) throw new Error(`Unsupported network: ${network}`);
    const provider = new import_ethers.ethers.JsonRpcProvider(rpcUrl);
    const tx = await provider.getTransaction(txHash);
    if (!tx) {
      result.message = "Transaction not found";
      return result;
    }
    const inputData = tx.data;
    const functionSelector = "0x9cef4ea1";
    if (inputData.startsWith(functionSelector)) {
      const actualVerificationHash = inputData.slice(10, 10 + 128);
      const hashMatches = actualVerificationHash.toLowerCase() === expectedVerificationHash.toLowerCase();
      result.verificationHashMatches = hashMatches;
      result.successful = hashMatches;
      result.message = hashMatches ? "Verification hash matches" : "Verification hash does not match";
    } else {
      result.message = "Transaction data does not contain expected function selector";
    }
    return result;
  } catch (error) {
    console.error("Error during transaction verification:", error);
    result.message = `An error occurred: ${error.message || error}`;
    return result;
  }
}

// src/v1_2/utils.ts
function getHashSum(content) {
  return content === "" ? "" : import_js_sha3.default.sha3_512(content);
}
function generateHashFromBase64(b64) {
  let hash = import_js_sha3.default.sha3_512(Buffer.from(b64, "base64"));
  return hash;
}
function verifyFileUtil(data) {
  const fileContentHash = data.content.file_hash || null;
  if (fileContentHash === null) {
    return [
      false,
      { error_message: "Revision contains a file, but no file content hash", file_hash: null }
    ];
  }
  const fileContent = data.file?.data;
  const hashFromb64 = generateHashFromBase64(fileContent ?? "");
  if (fileContentHash !== hashFromb64) {
    return [false, { error_message: "File content hash does not match", file_hash: null }];
  }
  return [true, { file_hash: fileContentHash, error_message: null }];
}
function verifyContentUtil(data) {
  let content = "";
  for (const slotContent of Object.values(data.content)) {
    content += slotContent;
  }
  const contentHash = getHashSum(content);
  let contentHashMatches = contentHash === data.content_hash;
  if (contentHashMatches) {
    return [contentHashMatches, contentHash];
  }
  return [false, "Content hash does not match"];
}
function verifyMetadataUtil(data) {
  const metadataHash = calculateMetadataHash(
    data.domain_id,
    data.time_stamp,
    data.previous_verification_hash ?? "",
    data.merge_hash ?? ""
  );
  let metadataHashMatches = metadataHash === data.metadata_hash;
  if (metadataHashMatches) {
    return [metadataHashMatches, metadataHash];
  }
  return [false, "Metadata hash does not match"];
}
function calculateMetadataHash(domainId, timestamp, previousVerificationHash = "", mergeHash = "") {
  return getHashSum(domainId + timestamp + previousVerificationHash + mergeHash);
}
function verifySignatureUtil(data, verificationHash) {
  let signatureOk = false;
  let status = "";
  if (verificationHash === "") {
    return [signatureOk, "Verification hash must not be empty"];
  }
  const paddedMessage = `I sign the following page verification_hash: [0x${verificationHash}]`;
  try {
    const recoveredAddress = import_ethers2.ethers.recoverAddress(
      import_ethers2.ethers.hashMessage(paddedMessage),
      data.signature
    );
    signatureOk = recoveredAddress.toLowerCase() === data.wallet_address.toLowerCase();
    status = signatureOk ? "Signature is Valid" : "Signature is invalid";
  } catch (e) {
    status = `An error occured retrieving signature : ${e}`;
  }
  return [signatureOk, status];
}
async function verifyWitnessUtil(witnessData, verification_hash, doVerifyMerkleProof, alchemyKey) {
  const actual_witness_event_verification_hash = getHashSum(
    witnessData.domain_snapshot_genesis_hash + witnessData.merkle_root
  );
  let tx_hash = witnessData.witness_event_transaction_hash.startsWith("0x") ? witnessData.witness_event_transaction_hash : `0x${witnessData.witness_event_transaction_hash}`;
  const etherScanResult = await checkTransaction(
    witnessData.witness_network,
    tx_hash,
    actual_witness_event_verification_hash,
    alchemyKey
  );
  if (actual_witness_event_verification_hash != witnessData.witness_event_verification_hash) {
    return [false, "Verification hashes do not match"];
  }
  if (doVerifyMerkleProof) {
    if (verification_hash === witnessData.domain_snapshot_genesis_hash) {
      return [true, "Verification hash is the same us domain snapshot genesis hash"];
    } else {
      const merkleProofIsOK = verifyMerkleIntegrity(
        witnessData.structured_merkle_proof,
        verification_hash
      );
      return [merkleProofIsOK, merkleProofIsOK ? "Merkle proof is OK" : "Error verifying merkle proof"];
    }
  }
  return [etherScanResult.successful, etherScanResult.message];
}
function verifyMerkleIntegrity(merkleBranch, verificationHash) {
  if (merkleBranch.length === 0) {
    return false;
  }
  let prevSuccessor = null;
  for (const idx in merkleBranch) {
    const node = merkleBranch[idx];
    const leaves = [node.left_leaf, node.right_leaf];
    if (prevSuccessor) {
      if (!leaves.includes(prevSuccessor)) {
        return false;
      }
    } else {
      if (!leaves.includes(verificationHash)) {
        return false;
      }
    }
    let calculatedSuccessor;
    if (!node.left_leaf) {
      calculatedSuccessor = node.right_leaf;
    } else if (!node.right_leaf) {
      calculatedSuccessor = node.left_leaf;
    } else {
      calculatedSuccessor = getHashSum(node.left_leaf + node.right_leaf);
    }
    if (calculatedSuccessor !== node.successor) {
      return false;
    }
    prevSuccessor = node.successor;
  }
  return true;
}

// src/v1_2/v1_2.ts
async function verifyRevision(revision, alchemyKey) {
  let defaultResultStatus = {
    status: 0 /* MISSING */,
    successful: false,
    message: ""
  };
  let revisionResult = {
    successful: false,
    file_verification: JSON.parse(JSON.stringify(defaultResultStatus)),
    content_verification: JSON.parse(JSON.stringify(defaultResultStatus)),
    witness_verification: JSON.parse(JSON.stringify(defaultResultStatus)),
    signature_verification: JSON.parse(JSON.stringify(defaultResultStatus)),
    metadata_verification: JSON.parse(JSON.stringify(defaultResultStatus))
  };
  const [fileIsCorrect, fileOut] = verifyFileUtil(revision.content);
  revisionResult.file_verification.status = 1 /* AVAILABLE */;
  revisionResult.file_verification.successful = fileIsCorrect;
  revisionResult.file_verification.message = fileOut.error_message ?? "";
  let [verifyContentIsOkay, resultMessage] = verifyContentUtil(revision.content);
  revisionResult.content_verification.status = 1 /* AVAILABLE */;
  revisionResult.content_verification.successful = verifyContentIsOkay;
  revisionResult.content_verification.message = resultMessage;
  let [metadataOk, metadataHashMessage] = verifyMetadataUtil(revision.metadata);
  revisionResult.metadata_verification.status = 1 /* AVAILABLE */;
  revisionResult.metadata_verification.successful = metadataOk;
  revisionResult.metadata_verification.message = metadataHashMessage;
  if (revision.signature) {
    let [signatureOk, signatureMessage] = verifySignatureUtil(revision.signature, revision.metadata.previous_verification_hash ?? "");
    revisionResult.signature_verification.status = 1 /* AVAILABLE */;
    revisionResult.signature_verification.successful = signatureOk;
    revisionResult.signature_verification.message = signatureMessage;
  }
  if (revision.witness) {
    try {
      const [success, message] = await verifyWitnessUtil(
        revision.witness,
        revision.metadata.previous_verification_hash ?? "",
        revision.witness.structured_merkle_proof.length > 1,
        alchemyKey
      );
      revisionResult.witness_verification.status = 1 /* AVAILABLE */;
      revisionResult.witness_verification.successful = success;
      revisionResult.witness_verification.message = message;
    } catch (err) {
      console.log("Witnessing error: ", err);
    }
  }
  let allSuccessful = true;
  for (const verification of Object.values(revisionResult)) {
    if (verification.status === 1 /* AVAILABLE */ && !verification.successful) {
      allSuccessful = false;
      break;
    }
  }
  revisionResult.successful = allSuccessful;
  return revisionResult;
}
function verifySignature(signature, previous_verification_hash) {
  let defaultResultStatus = {
    status: 0 /* MISSING */,
    successful: false,
    message: ""
  };
  let [signatureOk, signatureMessage] = verifySignatureUtil(signature, previous_verification_hash);
  defaultResultStatus.status = 1 /* AVAILABLE */;
  defaultResultStatus.successful = signatureOk;
  defaultResultStatus.message = signatureMessage;
  return defaultResultStatus;
}
async function verifyWitness(witness, verification_hash, doVerifyMerkleProof, alchemyKey) {
  let defaultResultStatus = {
    status: 0 /* MISSING */,
    successful: false,
    message: ""
  };
  let [witnessOk, witnessMessage] = await verifyWitnessUtil(witness, verification_hash, doVerifyMerkleProof, alchemyKey);
  defaultResultStatus.status = 1 /* AVAILABLE */;
  defaultResultStatus.successful = witnessOk;
  defaultResultStatus.message = witnessMessage;
  return defaultResultStatus;
}
async function verifyAquaChain(aquaChain, alchemyKey) {
  const hashChainResult = {
    successful: true,
    revisionResults: []
  };
  const revisionHashes = Object.keys(aquaChain.revisions);
  for (let j = 0; j < revisionHashes.length; j++) {
    const revision = aquaChain.revisions[revisionHashes[j]];
    const revisionResult = await verifyRevision(revision, alchemyKey);
    hashChainResult.revisionResults.push(revisionResult);
  }
  for (let i = 0; i < hashChainResult.revisionResults.length; i++) {
    const revisionResult = hashChainResult.revisionResults[i];
    if (!revisionResult.successful) {
      hashChainResult.successful = false;
      break;
    }
  }
  return Promise.resolve(hashChainResult);
}

// src/aquaVerifier.ts
var AquaVerifier = class {
  options;
  constructor(options = { version: 1.2, alchemyKey: "" }) {
    this.options = {
      strict: false,
      allowNull: false,
      customMessages: {},
      ...options
    };
  }
  fetchVerificationOptions() {
    return this.options;
  }
  verifyRevision(revision) {
    if (this.options.alchemyKey === "") {
      throw new Error("ALCHEMY KEY NOT SET");
    }
    if (this.options.version == 1.2) {
      return verifyRevision(revision, this.options.alchemyKey);
    }
    return null;
  }
  verifySignature(signature, previous_hash) {
    if (this.options.version == 1.2) {
      return verifySignature(signature, previous_hash);
    }
    return null;
  }
  verifyWitness(witness, verification_hash, doVerifyMerkleProof) {
    if (this.options.alchemyKey === "") {
      throw new Error("ALCHEMY KEY NOT SET");
    }
    if (this.options.version == 1.2) {
      return verifyWitness(witness, verification_hash, doVerifyMerkleProof, this.options.alchemyKey);
    }
    return null;
  }
  // TODO: Fix: verifier can't sign nor witness files. So this two methods might be out of place here because the verifier is verify AQUA Chain
  // public signFile() {
  // }
  // public witnessFile() {
  // }
  verifyMerkleTree() {
    throw new Error("Unimplmeneted error .... ");
  }
  verifyAquaChain(hashChain) {
    if (this.options.alchemyKey === "") {
      throw new Error("ALCHEMY KEY NOT SET");
    }
    if (this.options.version == 1.2) {
      return verifyAquaChain(hashChain, this.options.alchemyKey);
    }
    return null;
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AquaVerifier,
  ResultStatusEnum,
  getTimestampDirect,
  getTimestampSafe
});
