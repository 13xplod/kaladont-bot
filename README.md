# Kaladont Bot

Kaladont Bot is a Node.js chat bot for the popular Balkan word game **Kaladont**.

Players continue a word chain by using the last two letters of the previous word. The bot validates submitted words, blocks banned words, supports Serbian Latin characters, and keeps the game running in chat.

## Features

* Kaladont word-chain gameplay
* Serbian/Balkan Latin dictionary support
* Supports special letters: `č`, `ć`, `đ`, `š`, `ž`
* Banned words filtering
* Word validation system
* Dictionary update and merge scripts
* Simple Node.js setup
* Ready for Discloud deployment

## How the Game Works

1. A player sends a word.
2. The next player must send a word that starts with the last two letters of the previous word.
3. The bot checks whether the word exists in the dictionary.
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
```

## Installation

Clone the repository:

```bash
git clone https://github.com/13xplod/kaladont-bot.git
cd kaladont-bot
```

Install dependencies:

```bash
npm install
```

Create a `.env` file in the root folder and add your bot token:

```env
TOKEN=your_bot_token_here
```

Start the bot:

```bash
npm start
```

## Scripts

This project includes helper scripts for updating or merging dictionary and banned-word files.

Example files:

```txt
mergeAwords.js
updateBannedWords.js
```

Run a script with:

```bash
node scriptName.js
```

Example:

```bash
node updateBannedWords.js
```

## Deployment

This project is ready for deployment on **Discloud**.

Before uploading to Discloud, make sure these files are configured correctly:

```txt
discloud.config
package.json
.env
```

Your `.env` file should contain the required bot token.

## Version

Current version:

```txt
0.2.0-beta
```

## Repository

GitHub repository:

```txt
https://github.com/13xplod/kaladont-bot
```

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
