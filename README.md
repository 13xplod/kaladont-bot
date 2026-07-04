# Kaladont Bot

Kaladont Bot is a Node.js chat bot for the popular Balkan word game **Kaladont**.  
Players continue the word chain by using the last two letters of the previous word, while the bot validates words, blocks banned words, and keeps the game running in chat.

## Features

- Kaladont word-chain gameplay
- Serbian/Balkan Latin dictionary support
- Supports letters: `č`, `ć`, `đ`, `š`, `ž`
- Banned words filtering
- Dictionary update/merge scripts
- Simple Node.js setup
- Ready for Discloud deployment

## How the Game Works

1. A player sends a word.
2. The next player must send a word that starts with the last two letters of the previous word.
3. The bot checks if the word exists in the dictionary.
4. Invalid or banned words are rejected.
5. The game continues until someone makes a mistake or cannot continue.

## Project Structure

```txt
kaladont-bot/
├── .env
├── .gitignore
├── bannedWords.js
├── discloud.config
├── index.js
├── mergeAwords.js
├── package-lock.json
├── package.json
├── serbianDictionary.js
└── updateBannedWords.js
