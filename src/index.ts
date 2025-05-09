import { Client, GatewayIntentBits, Partials, Events, Message, TextChannel, NewsChannel, ThreadChannel, DMChannel } from 'discord.js';
import dotenv from 'dotenv';
import { processUserQueryWithLLM } from './llm_service';

// Global Error Handlers - Place these at the top
process.on('unhandledRejection', (reason, promise) => {
  console.error('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
  console.error('GLOBAL UNHANDLED REJECTION DETECTED!');
  console.error('Reason:', reason);
  console.error('Promise:', promise); // Log the promise that was rejected
  console.error('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
});

process.on('uncaughtException', (error) => {
  console.error('YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY');
  console.error('GLOBAL UNCAUGHT EXCEPTION DETECTED!');
  console.error('Error:', error);
  console.error('YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY');
  // It's often recommended to gracefully shut down here, but for debugging, we'll just log.
  // process.exit(1); 
});
// End Global Error Handlers

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
    console.log(`VERBOSE_LOG: [IndexTS] Logged in as ${c.user.tag} (ID: ${c.user.id})!`);
    console.log('VERBOSE_LOG: [IndexTS] Bot is ready to receive commands via LLM when directly mentioned.');
});

client.on(Events.MessageCreate, async (message: Message) => {
    console.log(`VERY_EARLY_LOG: [IndexTS] Message received from ${message.author.tag} (ID: ${message.author.id}): "${message.content}" in channel ${message.channel.id} of type ${message.channel.type}`);

    if (message.author.bot) {
        console.log('VERBOSE_LOG: [IndexTS] Message from a bot. Ignoring.');
        return;
    }

    // Check for direct bot mention FIRST
    if (client.user && message.mentions.users.has(client.user.id)) {
        const contentAfterMention = message.content.replace(/<@!?\d+>/g, '').trim();
        console.log(`VERBOSE_LOG: [IndexTS] Bot was DIRECTLY mentioned. Content after mention: "${contentAfterMention}"`);

        // PING command specifically for direct mentions
        if (contentAfterMention.toLowerCase() === 'ping') {
            console.log("VERBOSE_LOG: [IndexTS] Received PING command via direct mention.");
            try {
                await message.reply("Pong!");
                console.log("VERBOSE_LOG: [IndexTS] Replied PONG.");
            } catch (e) {
                console.error("VERBOSE_LOG: [IndexTS] ERROR replying to PING:", e);
            }
            return; 
        }

        if (contentAfterMention) {
            if (message.channel instanceof TextChannel || 
                message.channel instanceof NewsChannel || 
                message.channel instanceof ThreadChannel ||
                message.channel instanceof DMChannel) {
                try {
                    await message.channel.sendTyping();
                    console.log(`VERBOSE_LOG: [IndexTS] Sent typing indicator in channel type: ${message.channel.type}.`);
                } catch (typingError) {
                    console.warn(`VERBOSE_LOG: [IndexTS] WARNING: Failed to send typing indicator in channel ${message.channel.id}:`, typingError);
                }
            } else {
                console.log(`VERBOSE_LOG: [IndexTS] sendTyping not supported in channel type: ${message.channel.type}. Skipping.`);
            }
            
            console.log(`VERBOSE_LOG: [IndexTS] Calling processUserQueryWithLLM for: "${contentAfterMention}"`);
            try {
                const llmResponse = await processUserQueryWithLLM(message);
                console.log(`VERBOSE_LOG: [IndexTS] Received response from LLM service: ${llmResponse ? `"${llmResponse.substring(0,100)}..."` : 'null'}`);
                
                if (llmResponse) {
                    if (llmResponse.length > 2000) {
                        console.log('VERBOSE_LOG: [IndexTS] LLM response exceeds 2000 characters. Splitting.');
                        const parts = [];
                        for (let i = 0; i < llmResponse.length; i += 1990) { 
                            parts.push(llmResponse.substring(i, i + 1990));
                        }
                        for (let i = 0; i < parts.length; i++) {
                            console.log(`VERBOSE_LOG: [IndexTS] Replying with part ${i+1}/${parts.length}.`);
                            await message.reply(parts[i]);
                        }
                    } else {
                        console.log('VERBOSE_LOG: [IndexTS] Replying with LLM response.');
                        await message.reply(llmResponse);
                    }
                    console.log('VERBOSE_LOG: [IndexTS] Reply sent to Discord.');
                } else {
                    console.warn('VERBOSE_LOG: [IndexTS] WARNING: LLM service returned null or empty. Sending fallback message.');
                    await message.reply("I tried to think about that, but I got a bit stuck. Could you try rephrasing?");
                }
            } catch (processingError: any) {
                console.error('VERBOSE_LOG: [IndexTS] CRITICAL_ERROR: Error during LLM processing or reply: ', processingError);
                if (message.channel && !message.channel.isDMBased() && message.channel.isTextBased()) {
                     try { await message.reply("Oh dear, something went quite wrong on my end. Please try again in a moment."); } catch (e) { console.error("VERBOSE_LOG: [IndexTS] Failed to send error reply after processingError.", e); }
                }
            }
        } else {
            console.log('VERBOSE_LOG: [IndexTS] Bot directly mentioned with no content after mention. Sending default greeting.');
            await message.reply("Hey there! How can I help you manage your servers today?");
        }
    } else if (message.mentions.roles.size > 0) {
        // Log if a role was mentioned, but not necessarily the bot directly via user mention
        const mentionedRoleIDs = message.mentions.roles.map(role => role.id);
        console.log(`VERBOSE_LOG: [IndexTS] Message contained role mentions (IDs: ${mentionedRoleIDs.join(', ')}), but not a direct user mention of the bot. Bot User ID: ${client.user?.id}. Ignoring for LLM processing.`);
    } else if (message.content.toLowerCase().includes('@asuna')) {
        // Fallback for cases where the mention might not be parsed correctly by discord.js but content includes @Asuna
        // This is less reliable and generally not needed if direct mentions work.
        console.log("VERBOSE_LOG: [IndexTS] Message content includes '@asuna' but was not parsed as a direct user mention. Check if this was intended. Bot User ID: " + client.user?.id + ". Ignoring for LLM processing based on current direct mention logic.");
    }
});

client.login(token); 