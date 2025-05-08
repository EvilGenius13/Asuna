import { Client, GatewayIntentBits, Partials, Events, Message, TextChannel } from 'discord.js';
import dotenv from 'dotenv';
import { handleAsunaHello, handleListServers, handleServerStatus } from './commands/general';
import { processUserQueryWithLLM } from './llm_service';

dotenv.config();

const token = process.env.DISCORD_BOT_TOKEN;

if (!token) {
    console.error('CRITICAL: Discord bot token not found. Please set the DISCORD_BOT_TOKEN environment variable.');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message],
});

client.once(Events.ClientReady, c => {
    console.log(`Logged in as ${c.user.tag}!`);
    console.log('Bot is ready to receive commands.');
});

client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;
    if (!(message.channel instanceof TextChannel)) return;

    if (client.user && message.mentions.users.has(client.user.id)) {
        const contentAfterMention = message.content.replace(/<@!?\d+>/g, '').trim();
        const parts = contentAfterMention.toLowerCase().split(/\s+/);
        
        const commandBase = parts[0]; 
        const subCommand = parts.length > 1 ? parts[1] : null;
        
        if (commandBase === 'hello' || commandBase === 'hi') {
            await handleAsunaHello(message);
        } else if (commandBase === 'list' && subCommand === 'servers') {
            await handleListServers(message);
        } else if (commandBase === 'server' && subCommand === 'status') {
            const serverQueryOriginalCase = message.content.replace(/<@!?\d+>/g, '').trim().split(/\s+/).slice(2).join(' ');
            if (serverQueryOriginalCase) {
                await handleServerStatus(message, serverQueryOriginalCase);
            } else {
                await message.reply("Please specify a server name or ID. Usage: `@Asuna server status <name_or_id>`");
            }
        } else {
            if (contentAfterMention) {
                console.log(`[INFO] Passing to LLM: "${contentAfterMention}" from ${message.author.tag}`);
                await message.channel.sendTyping(); 
                const llmResponse = await processUserQueryWithLLM(contentAfterMention);
                if (llmResponse) {
                    await message.reply(llmResponse);
                } else {
                    await message.reply("I tried to think about that, but I got a bit stuck. Could you try rephrasing?");
                }
            } else {
                // User just mentioned the bot with no further text
                // You could have a default reply here, e.g., a help message or a friendly greeting.
                // For now, we'll do nothing if there's no content after the mention and it's not a known command.
            }
        }
    } else {
        // console.log(`[DEBUG] Bot was NOT mentioned in message: "${message.content}"`);
    }

    // Keep the simple !hello command for basic testing if needed, can be removed later
    // if (message.content === '!hello') {
    //     console.log(`[DEBUG] Traditional '!hello' command received from ${message.author.tag}.`);
    //     message.reply(`Hello ${message.author.tag}!`);
    // }
});

client.login(token); 