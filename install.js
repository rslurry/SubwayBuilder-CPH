const fs = require('fs');
const path = require('path');
const os = require('os');

// --- DYNAMIC CONFIGURATION FROM MANIFEST ---
const GAME_FOLDER_NAME = "metro-maker4";
const MANIFEST_FILE = "manifest.json";

// Read and parse manifest.json to get the ID
let manifest;
try {
    const manifestPath = path.join(__dirname, MANIFEST_FILE);
    if (!fs.existsSync(manifestPath)) {
        throw new Error("File not found");
    }
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (err) {
    console.error(`Error: Could not read ${MANIFEST_FILE}. Make sure it is in the same folder as this script.`);
    console.error(`Details: ${err.message}`);
    process.exit(1);
}

// Parse the ID (e.g., "com.mhmoeller.CPH")
// Expected format: com.author.CityName
const idParts = manifest.id ? manifest.id.split('.') : [];
let author = "Unknown";
let cityName = "Mod";

if (idParts.length >= 3) {
    // Standard format: com.author.city
    author = idParts[1]; 
    cityName = idParts.slice(2).join('.');
} else if (manifest.id) {
    // Fallback if ID format is non-standard
    cityName = manifest.id;
}

// Variables for the installer
const DISPLAY_NAME = `${author}'s ${cityName}`;  // e.g. "mhmoeller's CPH"
const TARGET_FOLDER_NAME = cityName;             // e.g. "CPH" (The folder inside cities/data/)

// Files to move to cities/data/TARGET_FOLDER_NAME
const DATA_FILES = [
    "roads.geojson.gz",
    "runways_taxiways.geojson.gz",
    "ocean_depth_index.json.gz",
    "buildings_index.json.gz",
    "demand_data.json.gz"
];
// 1. Find path to cities/data
function getGameDataPath() {
    const platform = os.platform();
    let appDataPath;

    if (platform === 'win32') {
        // Windows: %APPDATA%/metro-maker4
        appDataPath = process.env.APPDATA;
    } else if (platform === 'darwin') {
        // Mac: ~/Library/Application Support/metro-maker4
        appDataPath = path.join(os.homedir(), 'Library', 'Application Support');
    } else {
        // Linux (Fallback): ~/.config/metro-maker4
        appDataPath = path.join(os.homedir(), '.config');
    }

    if (!appDataPath) {
        console.error("ERROR: Couldn't find AppData/Home directory.");
        process.exit(1);
    }

    return path.join(appDataPath, GAME_FOLDER_NAME);
}

// 2. Find source folder ( where the.gz files are now?)
function findSourceDataFolder(startDir) {
    // Check directly in 'data' folder first
    const directPath = path.join(startDir, 'data');
    if (fs.existsSync(directPath) && fs.lstatSync(directPath).isDirectory()) {
        return directPath;
    }

    // If user have unzipped CITY.zip to a CITY folder (CITY/CITY/data)
    const subdirs = fs.readdirSync(startDir).filter(file => {
        return fs.lstatSync(path.join(startDir, file)).isDirectory();
    });

    for (const subdir of subdirs) {
        const nestedPath = path.join(startDir, subdir, 'data');
        if (fs.existsSync(nestedPath) && fs.lstatSync(nestedPath).isDirectory()) {
            console.log(`Found data in folder: ${subdir}/data`);
            return nestedPath;
        }
    }

    return null;
}

// Function to create a portable serve.bat
function createServeBatch(baseDir) {
    const scriptsDir = path.join(baseDir, 'scripts');
    let batContent;
    let fext;
    // We create a batch file that hardcodes the path to the scripts folder.
    // This allows the user to move the .bat file anywhere (Desktop, etc.)
    if (os.platform() === 'win32') {
        // Windows: powershell
        fext = '.bat';
        batContent = `@echo off
title PMTiles Server (${DISPLAY_NAME})
echo Starting map server...
echo This window must remain open while playing.
echo.
cd /d "${scriptsDir}"
.\\pmtiles.exe serve . --port 8081 --cors=*
if %errorlevel% neq 0 (
    echo.
    echo Error: Could not start pmtiles.exe
    pause
)
`;
    } else {
        // Unix: shell script
        fext = '.sh';
        batContent = `#!/usr/bin/env sh

echo "Starting map server..."
echo "This window must remain open while playing."
echo

# Navigate to the script directory
cd "${scriptsDir}"

# Run pmtiles (Linux/macOS binary assumed to be named 'pmtiles')
./pmtiles serve . --port 8081 --cors="*"
status=$?

if [ $status -ne 0 ]; then
    echo
    echo "Error: Could not start pmtiles"
    # macOS/Linux equivalent of 'pause'
    read -r -p "Press Enter to exit..."
fi
`;
    }
    const batPath = path.join(baseDir, `serve${fext}`);
    try {
        fs.writeFileSync(batPath, batContent);
        console.log(` [OK] Created portable serve${fext}`);
        console.log(`      (You can move this file to your Desktop if you want)`);
    } catch (err) {
        console.error(`Error: Could not create serve${fext}: ${err.message}`);
    }
}

async function install() {
    console.log(`--- Installing ${DISPLAY_NAME} Map Pack (Node.js) ---`);

    const gameDir = getGameDataPath();
    const currentDir = __dirname;
    const destDir = path.join(gameDir, 'cities', 'data', TARGET_FOLDER_NAME);

    // Find source
    const sourceDir = findSourceDataFolder(currentDir);
    
    if (!sourceDir) {
        console.error("ERROR: Couldn't find folder 'data' with the files.");
        console.error("Make sure you have all the files needed: roads.geojson.gz,");
		console.error("runways_taxiways.geojson.gz, ocean_depth_index.json.gz,");
		console.error("buildings_index.json.gz and demand_data.json.gz");
        process.exit(1);
    }

    // check if destination needs to be created
    if (!fs.existsSync(destDir)) {
        console.log(`Creating folder: ${destDir}`);
        fs.mkdirSync(destDir, { recursive: true });
    } else {
        console.log(`folder already exists: ${destDir}`);
    }

    console.log("\nCopying files...");
    let filesMoved = 0;

    for (const file of DATA_FILES) {
        const srcPath = path.join(sourceDir, file);
        const destPath = path.join(destDir, file);

        if (fs.existsSync(srcPath)) {
            try {
                // copyFileSync overwrites files if they already exist
                fs.copyFileSync(srcPath, destPath);
                console.log(` [OK] ${file}`);
                filesMoved++;
            } catch (err) {
                console.error(`Error: Couldn't copy ${file}: ${err.message}`);
            }
        } else {
            console.warn(`Warning: Couldn't find ${file} in source folder.`);
        }
    }

    if (filesMoved === DATA_FILES.length) {
        console.log(`\nSUCCESS! All ${filesMoved} files got installed correctly.`);
    } else {
        console.log(`\nWARNING: Only ${filesMoved} of ${DATA_FILES.length} files got installed.`);
    }
    
	if (filesMoved === DATA_FILES.length) {
        console.log(`\nSUCCESS! All ${filesMoved} files were installed correctly.`);
    } else {
        console.log(`\nWARNING: Only ${filesMoved} of ${DATA_FILES.length} files were installed.`);
    }

    // --- NYT: Opret serve.bat ---
    console.log("\nCreating server script...");
    createServeBatch(currentDir); 
    // ----------------------------
    let fext;
    if (os.platform() === 'win32') {
        fext = '.bat'
    } else {
        fext = '.sh'
    }
    console.log(`\nYou can now start the 'serve${fext}' file (feel free to move it to your Desktop).`);
    console.log("Then start the game.");
}

try {
    install();
} catch (error) {
    console.error("An unexpected error occurred:", error);
}

// Keep the console open for 5 minutes so that the user has time to read the message (important for Windows)
// (Or until they kill the process)
setTimeout(() => {}, 300000);
