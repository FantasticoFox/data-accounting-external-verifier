#!/usr/bin/env bash

# Function to check if previous command was successful
check_status() {
    if [ $? -ne 0 ]; then
        echo "Error: Command failed"
        exit 1
    fi
}

echo "Starting file modifications and notarization..."

# Copy README.md to README2.md
echo "1. Copying README.md to README3.md..."
cp README.md README3.md
check_status

# Notarize README.md
echo "2. Notarizing README.md..."
./notarize.js README.md
check_status

# Modify README.md content (remove first character)
echo "3. Modifying README.md content..."
sed -i '1s/^.//' README.md
check_status

# Notarize README.md again
echo "4. Notarizing modified README.md..."
./notarize.js README.md
check_status

# Copy README.md to README1.md
echo "5. Copying README.md to README3.md..."
cp README.md README2.md
check_status

# Modify README.md.aqua.json (replace only first README.md with README2.md in file_index)
echo "5. Modifying README.md.aqua.json..."
sed -i '/"file_index": {/,/}/{0,/"README.md"/s/"README.md"/"README3.md"/}' README.md.aqua.json
check_status

# Modify README.md content (remove first character)
echo "8. Modifying README.md content..."
sed -i '1s/^.//' README.md
check_status

# Notarize README.md
echo "7. Notarizing README.md..."
./notarize.js README.md
check_status

# Modify README.md.aqua.json (replace only first README.md with README2.md in file_index)
echo "10. Modifying README.md.aqua.json..."
sed -i '/"file_index": {/,/}/{0,/"README.md"/s/"README.md"/"README2.md"/}' README.md.aqua.json
check_status

# Verify README.md
echo "11. Verifying README.md..."
./verify.js README.md
check_status

# echo "All operations completed successfully!" 

# Cleanup section
 echo -e "\nStarting cleanup operations..."

# echo "1. Removing README2.md, README3.md ..."
 rm README2.md && rm README3.md
# check_status

# echo "2. Removing README.md.aqua.json..."
 rm README.md.aqua.json
# check_status

# echo "3. Restoring original README.md..."
 git restore README.md
# check_status

 echo "Cleanup completed successfully!"
