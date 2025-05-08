# Asuna Discord Bot

A discord bot that uses an LLM to manage game servers via the Pterodactyl API.

## Setup

1. Install dependencies: `npm install`
2. Create a `.env` file in the root of the project and add your Discord bot token:
    ```
    DISCORD_BOT_TOKEN=YOUR_ACTUAL_BOT_TOKEN
    PTERODACTYL_API_URL=https://your-pterodactyl-url/api/application
    PTERODACTYL_CLIENT_API_KEY=YOUR_ACTUAL_CLIENT_API_KEY
    OPENAI_API_KEY=YOUR_ACTUAL_OPENAI_API_KEY
    ```
3. Build the project: `npm run build`
4. Run the bot: `npm start`