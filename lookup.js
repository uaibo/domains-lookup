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
console.log(`🧮 ${allCombos.length.toLocaleString()} possible combinations`);

const combos = filterByPattern(allCombos, patternArg);

const available = {};
tlds.forEach((tld) => (available[tld] = []));

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

    // Write domains to file, one per line
    const content = domains.join("\n");
    fs.writeFileSync(filename, content);
    console.log(
      `📄 Available domains saved to ${filename} (${domains.length} domains)`
    );
  }
}

for (const tld of tlds) {
  console.log(`\n🔍 Checking ${tld} domains...`);
  for (let i = 0; i < combos.length; i += BATCH_SIZE) {
    const batch = combos
      .slice(i, i + BATCH_SIZE)
      .map((combo) => `${combo}${tld}`);

    const results = await checkDomainsBatch(batch);

    for (const res of results) {
      if (res.available) {
        available[tld].push(res.domain);
        console.log(`🟢 Available: ${res.domain}`);
      } else {
        //console.log(`🔴 Taken: ${res.domain}`);
      }
    }

    console.log(`⏳ Processed ${i + batch.length}/${combos.length} for ${tld}`);
    await new Promise((r) => setTimeout(r, DELAY));
  }
}

fs.writeFileSync("available.json", JSON.stringify(available, null, 2));
console.log("✅ Done! Results saved to available.json");

writeAvailableDomainsToFile(available, numberOfLetters);
