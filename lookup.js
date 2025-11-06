import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

const GODADDY_API_KEY = process.env.GODADDY_API_KEY;
const GODADDY_API_SECRET = process.env.GODADDY_API_SECRET;

if (!GODADDY_API_KEY || !GODADDY_API_SECRET) {
  console.error("❌ Missing GoDaddy API credentials in .env file");
  process.exit(1);
}

const numberOfLetters = parseInt(process.argv[2]);
const tldArg = process.argv[3] || ".com";
const patternArg = process.argv[4] || "auto"; // Pattern filter: "auto", "CVC", "VCV", "CVCV", "none"
const tlds = tldArg
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);
const BATCH_SIZE = 50;
const DELAY = 2000;

if (!numberOfLetters || numberOfLetters < 1) {
  console.error(
    "❌ Invalid number of letters. Example: node lookup.js 3 .com,.io [pattern]"
  );
  console.error(
    "   Patterns: 'auto' (default), 'CVC', 'VCV', 'CVCV', 'CVC,VCV' (multiple), or 'none'"
  );
  process.exit(1);
}

console.log(
  `🧩 Config: ${numberOfLetters}-letter combos | TLDs: ${tlds.join(
    ", "
  )} | Pattern: ${patternArg}`
);

// Vowel and consonant definitions
const VOWELS = "aeiou";
const CONSONANTS = "bcdfghjklmnpqrstvwxyz";

function isVowel(char) {
  return VOWELS.includes(char.toLowerCase());
}

function isConsonant(char) {
  return CONSONANTS.includes(char.toLowerCase());
}

function getPattern(word) {
  // Convert word to pattern: C for consonant, V for vowel
  return word
    .split("")
    .map((char) => (isVowel(char) ? "V" : "C"))
    .join("");
}

function matchesPattern(word, pattern) {
  const wordPattern = getPattern(word);

  // Exact match if lengths are equal
  if (wordPattern.length === pattern.length) {
    return wordPattern === pattern;
  }

  // If pattern is shorter, check if word pattern starts with, ends with, or contains it
  if (pattern.length < wordPattern.length) {
    return (
      wordPattern.startsWith(pattern) ||
      wordPattern.endsWith(pattern) ||
      wordPattern.includes(pattern)
    );
  }

  // If pattern is longer, check if it starts with or contains the word pattern
  return pattern.startsWith(wordPattern) || pattern.includes(wordPattern);
}

function hasGoodPronounceability(word) {
  const pattern = getPattern(word);

  // Avoid too many consecutive consonants (hard to pronounce)
  if (pattern.includes("CCC") || pattern.includes("CCCC")) {
    return false;
  }

  // Avoid too many consecutive vowels (less common in English)
  if (pattern.includes("VVV")) {
    return false;
  }

  // Ensure at least one vowel (for pronounceability)
  if (!pattern.includes("V")) {
    return false;
  }

  // Ensure at least one consonant (for structure)
  if (!pattern.includes("C")) {
    return false;
  }

  return true;
}

function getBestPatternsForLength(length) {
  // Best patterns for catchy, pronounceable names by length
  const bestPatterns = {
    2: ["CV", "VC"], // be, go, it, up
    3: ["CVC", "VCV", "CVV"], // cat, dog, ace, ice, bee, see
    4: ["CVCV", "CVCC", "VCVC", "CVVC"], // data, code, logo, idea, book, look
    5: ["CVCVC", "CVCCV", "CVCVV", "VCVCV"], // music, table, happy, apple, ocean
    6: ["CVCVCV", "CVCCVC", "CVCVCC", "VCVCVC"], // domain, market, system, office
    7: ["CVCVCVC", "CVCCVCV", "CVCVCCV"], // company, service, product
  };

  return bestPatterns[length] || [];
}

function filterByPattern(combos, patternFilter) {
  if (patternFilter === "none") {
    return combos;
  }

  let patternsToMatch = [];

  if (patternFilter === "auto") {
    // Auto-select best patterns for the given length
    patternsToMatch = getBestPatternsForLength(numberOfLetters);
    if (patternsToMatch.length === 0) {
      // Fallback: just filter for good pronounceability
      console.log(
        "⚠️  No predefined patterns for this length, using pronounceability filter"
      );
      return combos.filter(hasGoodPronounceability);
    }
  } else {
    // Use specified pattern(s) - can be comma-separated
    patternsToMatch = patternFilter
      .split(",")
      .map((p) => p.trim().toUpperCase());
  }

  const filtered = combos.filter((combo) => {
    // Check if it matches any of the specified patterns
    const matches = patternsToMatch.some((pattern) =>
      matchesPattern(combo, pattern)
    );

    // Also ensure good pronounceability
    return matches && hasGoodPronounceability(combo);
  });

  console.log(
    `🎯 Pattern filter: ${patternsToMatch.join(
      ", "
    )} | Filtered to ${filtered.length.toLocaleString()} combos (from ${combos.length.toLocaleString()})`
  );

  return filtered;
}

function generateCombos(length) {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const results = [];
  const recurse = (prefix, depth) => {
    if (depth === length) {
      results.push(prefix);
      return;
    }
    for (const char of letters) recurse(prefix + char, depth + 1);
  };
  recurse("", 0);
  return results;
}

const allCombos = generateCombos(numberOfLetters);
console.log(
  `🧮 ${allCombos.length.toLocaleString()} total possible combinations`
);

const combos = filterByPattern(allCombos, patternArg);
console.log(
  `✅ Will check ${combos.length.toLocaleString()} filtered combinations`
);

// Create domains folder if it doesn't exist
const DOMAINS_FOLDER = "domains";
if (!fs.existsSync(DOMAINS_FOLDER)) {
  fs.mkdirSync(DOMAINS_FOLDER, { recursive: true });
}

const available = {};
tlds.forEach((tld) => (available[tld] = []));

// Generate filenames at the start
const now = new Date();
const year = now.getFullYear();
const month = String(now.getMonth() + 1).padStart(2, "0");
const day = String(now.getDate()).padStart(2, "0");
const hours = String(now.getHours()).padStart(2, "0");
const minutes = String(now.getMinutes()).padStart(2, "0");
const seconds = String(now.getSeconds()).padStart(2, "0");

const textFilePaths = {};
const domainCounters = {}; // Track how many domains checked per TLD
const SAVE_INTERVAL = 500; // Save after every 500 checks

// Initialize text files for each TLD
for (const tld of tlds) {
  const tldName = tld.replace(/^\./, "");
  const filename = `${year}-${month}-${day}-${hours}-${minutes}-${seconds}-available-${numberOfLetters}-letter-${tldName}.txt`;
  const filepath = `${DOMAINS_FOLDER}/${filename}`;
  textFilePaths[tld] = filepath;
  domainCounters[tld] = 0;

  // Initialize empty file (or clear if exists)
  fs.writeFileSync(filepath, "");
  console.log(`📝 Initialized file: ${filepath}`);
}

function appendDomainsToFile(tld, domains) {
  if (domains.length === 0) return;

  const filepath = textFilePaths[tld];
  const content = domains.join("\n") + "\n";
  fs.appendFileSync(filepath, content);
}

async function checkDomainsBatch(domains) {
  const url = `https://api.ote-godaddy.com/v1/domains/available?checkType=FAST`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `sso-key ${GODADDY_API_KEY}:${GODADDY_API_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(domains),
  });

  if (!response.ok) {
    console.error("⚠️ API Error:", await response.text());
    return [];
  }

  const data = await response.json();
  return data.domains || [];
}

function writeAvailableDomainsToFile(available, numberOfLetters) {
  // Generate timestamp once for all files
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");

  // Create a file for each TLD that has available domains
  for (const tld in available) {
    const domains = available[tld];

    if (domains.length === 0) {
      continue;
    }

    // Remove the leading dot from TLD for filename (e.g., ".com" -> "com")
    const tldName = tld.replace(/^\./, "");

    // Generate filename: Y-m-d-H-i-s-available-{numberOfLetters}-letter-{tld}.txt
    const filename = `${year}-${month}-${day}-${hours}-${minutes}-${seconds}-available-${numberOfLetters}-letter-${tldName}.txt`;
    const filepath = `${DOMAINS_FOLDER}/${filename}`;

    // Write domains to file, one per line
    const content = domains.join("\n");
    fs.writeFileSync(filepath, content);
    console.log(
      `📄 Available domains saved to ${filepath} (${domains.length} domains)`
    );
  }
}

for (const tld of tlds) {
  console.log(`\n🔍 Checking ${tld} domains...`);
  const pendingDomains = []; // Buffer for domains to save
  let lastSavedAt = 0; // Track when we last saved

  for (let i = 0; i < combos.length; i += BATCH_SIZE) {
    const batch = combos
      .slice(i, i + BATCH_SIZE)
      .map((combo) => `${combo}${tld}`);

    const results = await checkDomainsBatch(batch);

    for (const res of results) {
      if (res.available) {
        available[tld].push(res.domain);
        pendingDomains.push(res.domain);
        console.log(`🟢 Available: ${res.domain}`);
      } else {
        //console.log(`🔴 Taken: ${res.domain}`);
      }
    }

    domainCounters[tld] += batch.length;
    const checkedCount = domainCounters[tld];

    // Save to file after every SAVE_INTERVAL checks
    // Check if we've crossed a SAVE_INTERVAL threshold since last save
    const shouldSave =
      checkedCount - lastSavedAt >= SAVE_INTERVAL ||
      checkedCount === combos.length;

    if (shouldSave && pendingDomains.length > 0) {
      appendDomainsToFile(tld, pendingDomains);
      console.log(
        `💾 Saved ${pendingDomains.length} domains to ${textFilePaths[tld]} (${checkedCount} checked)`
      );
      pendingDomains.length = 0; // Clear buffer
      lastSavedAt = checkedCount;
    }

    console.log(`⏳ Processed ${checkedCount}/${combos.length} for ${tld}`);
    await new Promise((r) => setTimeout(r, DELAY));
  }

  // Save any remaining domains at the end
  if (pendingDomains.length > 0) {
    appendDomainsToFile(tld, pendingDomains);
    console.log(
      `💾 Saved final ${pendingDomains.length} domains to ${textFilePaths[tld]}`
    );
  }
}

const jsonFilePath = `${DOMAINS_FOLDER}/available.json`;
fs.writeFileSync(jsonFilePath, JSON.stringify(available, null, 2));
console.log(`✅ Done! Results saved to ${jsonFilePath}`);

// Text files are already saved incrementally during the check process
for (const tld of tlds) {
  const count = available[tld].length;
  if (count > 0) {
    console.log(`📄 ${textFilePaths[tld]}: ${count} domains`);
  }
}
