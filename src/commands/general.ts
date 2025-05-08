import { Message, EmbedBuilder } from 'discord.js';
import { listServers, getServerResources, PterodactylServer, PterodactylServerResourceState } from '../pterodactyl'; // Adjust path as needed

export async function handleAsunaHello(message: Message): Promise<void> {
    // The check for 'hello' is now primarily done in index.ts before calling this.
    await message.reply('hey!');
}

export async function handleListServers(message: Message): Promise<void> {
    try {
        const servers = await listServers();
        if (!servers || servers.length === 0) {
            await message.reply("I couldn't find any servers, or there was an issue fetching them.");
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('Your Pterodactyl Servers')
            .setTimestamp();

        if (servers.length > 0) {
            let description = '';
            servers.forEach(server => {
                const status = server.attributes.status;
                const serverName = server.attributes.name;
                const serverId = server.attributes.identifier;
                description += `**${serverName}** (${serverId})\nStatus: ${status ? status : 'N/A'}\n\n`;
            });
            embed.setDescription(description.trim());
        } else {
            embed.setDescription("No servers found.");
        }
        
        await message.reply({ embeds: [embed] });

    } catch (error) {
        console.error("Error in handleListServers command:", error);
        await message.reply("Sorry, I ran into an error trying to list the servers.");
    }
}

function formatBytes(bytes: number, decimals = 2): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatUptime(milliseconds: number): string {
    if (milliseconds < 0) milliseconds = 0;
    let seconds = Math.floor(milliseconds / 1000);
    let minutes = Math.floor(seconds / 60);
    let hours = Math.floor(minutes / 60);
    let days = Math.floor(hours / 24);

    seconds %= 60;
    minutes %= 60;
    hours %= 24;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

    return parts.join(' ');
}

export async function handleServerStatus(message: Message, serverQuery: string): Promise<void> {
    if (!serverQuery) {
        await message.reply("Please provide a server name or ID. Usage: `@Asuna server status <name_or_id>`");
        return;
    }

    try {
        const allServers = await listServers();
        if (!allServers || allServers.length === 0) {
            await message.reply("I couldn't fetch any server data. Please check Pterodactyl integration.");
            return;
        }

        let targetServer: PterodactylServer | undefined = allServers.find(s => s.attributes.identifier === serverQuery);

        if (!targetServer) {
            // If not found by ID, try by name (case-insensitive)
            const lowerCaseQuery = serverQuery.toLowerCase();
            const matchingByName = allServers.filter(s => s.attributes.name.toLowerCase().includes(lowerCaseQuery));
            if (matchingByName.length === 1) {
                targetServer = matchingByName[0];
            } else if (matchingByName.length > 1) {
                let response = "I found multiple servers matching that name. Please be more specific or use the server ID:\n";
                matchingByName.forEach(s => {
                    response += `- **${s.attributes.name}** (ID: \`${s.attributes.identifier}\`)\n`;
                });
                await message.reply(response);
                return;
            }
        }

        if (!targetServer) {
            await message.reply(`I couldn't find a server with the ID or name matching "${serverQuery}". Try \`@Asuna list servers\` to see available servers.`);
            return;
        }

        const serverId = targetServer.attributes.identifier;
        const serverName = targetServer.attributes.name;

        const resources = await getServerResources(serverId);
        if (!resources) {
            await message.reply(`I found server "${serverName}" (ID: \`${serverId}\`) but couldn't fetch its resource information. There might be an issue with the API or the server itself.`);
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(resources.current_state === 'running' ? 0x00FF00 : (resources.current_state === 'offline' ? 0xFF0000 : 0xFFA500))
            .setTitle(`Server Status: ${serverName}`)
            .setDescription(`Current State: **${resources.current_state.toUpperCase()}**`)
            .addFields(
                { name: 'CPU Usage', value: `${(resources.resources.cpu_absolute / 100).toFixed(2)}%`, inline: true },
                { name: 'Memory Usage', value: `${formatBytes(resources.resources.memory_bytes)}`, inline: true },
                { name: 'Disk Usage', value: `${formatBytes(resources.resources.disk_bytes)}`, inline: true },
                { name: 'Uptime', value: formatUptime(resources.resources.uptime), inline: true },
                { name: 'Network RX', value: formatBytes(resources.resources.network_rx_bytes), inline: true },
                { name: 'Network TX', value: formatBytes(resources.resources.network_tx_bytes), inline: true }
            )
            .setFooter({ text: `ID: ${serverId}` })
            .setTimestamp();

        await message.reply({ embeds: [embed] });

    } catch (error) {
        console.error(`Error in handleServerStatus command for query "${serverQuery}":`, error);
        await message.reply(`Sorry, I ran into an error trying to get the status for "${serverQuery}".`);
    }
} 