import OpenAI from 'openai';
import dotenv from 'dotenv';
import { 
    listServers, 
    getServerResources, 
    sendPowerSignal, 
    getServersWithOnlineStatus,
    listNestsWithEggs,
    getEggDetails,
    createServer,
    findAvailableAllocation,
    PterodactylServer, 
    PterodactylServerResourceState,
    ServerOnlineStatusInfo,
    PterodactylNest,
    PterodactylEgg,
    PterodactylEggVariable,
    ServerCreationOptions,
    PterodactylAllocation
} from './pterodactyl'; // Import actual functions
import { Message, TextChannel, NewsChannel, ThreadChannel, DMChannel } from 'discord.js'; // Import Message and channel types

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// Read Pterodactyl default IDs directly in llm_service
const PTERO_DEFAULT_OWNER_ID_STR = process.env.PTERODACTYL_DEFAULT_OWNER_ID;
const PTERO_DEFAULT_NODE_ID_STR = process.env.PTERODACTYL_DEFAULT_NODE_ID;

let PTERO_DEFAULT_OWNER_ID: number | undefined;
let PTERO_DEFAULT_NODE_ID: number | undefined;

if (PTERO_DEFAULT_OWNER_ID_STR) {
    PTERO_DEFAULT_OWNER_ID = parseInt(PTERO_DEFAULT_OWNER_ID_STR, 10);
    if (isNaN(PTERO_DEFAULT_OWNER_ID)) {
        console.error('CRITICAL: Pterodactyl Default Owner ID is not a valid number. Server creation will fail.');
        PTERO_DEFAULT_OWNER_ID = undefined;
    }
} else {
    console.warn('WARNING: Pterodactyl Default Owner ID not found in .env. Server creation will likely fail.');
}

if (PTERO_DEFAULT_NODE_ID_STR) {
    PTERO_DEFAULT_NODE_ID = parseInt(PTERO_DEFAULT_NODE_ID_STR, 10);
    if (isNaN(PTERO_DEFAULT_NODE_ID)) {
        console.error('CRITICAL: Pterodactyl Default Node ID is not a valid number. Server creation will fail.');
        PTERO_DEFAULT_NODE_ID = undefined;
    }
} else {
    console.warn('WARNING: Pterodactyl Default Node ID not found in .env. Server creation will fail (cannot find allocations).');
}

console.log('VERBOSE_LOG: [LLM Service] Initializing OpenAI client...');
const openai = OPENAI_API_KEY ? new OpenAI({
    apiKey: OPENAI_API_KEY,
    timeout: 45 * 1000, // 45 seconds timeout
    maxRetries: 1,
}) : null;
if (openai) {
    console.log('VERBOSE_LOG: [LLM Service] OpenAI client initialized.');
} else if (OPENAI_API_KEY) {
    console.error('VERBOSE_LOG: [LLM Service] CRITICAL_ERROR: OpenAI API Key was provided, but client initialization failed!');
} else {
    console.log('VERBOSE_LOG: [LLM Service] OpenAI client not initialized as API key is missing.');
}

// Simplified PterodactylServer info for the list_pterodactyl_servers tool response
interface SimplifiedPterodactylServerInfo {
    name: string;
    uuid: string;
    identifier: string;
    description: string;
    limits: any; // Keeping full limits object as requested
    default_port?: number;
}

// New interface for simplified Nest/Egg structure for LLM
interface SimplifiedNestInfo {
    nest_name: string;
    nest_description: string | null;
    available_eggs: {
        egg_name: string;
        egg_description: string | null;
    }[];
}

// New interface for simplified Egg details for LLM
interface SimplifiedEggVariable {
    name: string;
    description: string;
    env_variable: string;
    default_value: string; // Combined from user_viewable and user_editable
}

interface SimplifiedEggDetails {
    egg_name: string;
    egg_description: string | null;
    nest_name: string; // For context
    variables: SimplifiedEggVariable[];
}

// Define the tools (our Pterodactyl functions) the LLM can use
const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
        type: 'function',
        function: {
            name: 'list_pterodactyl_servers_basic_info',
            description: 'Get a list of all Pterodactyl game servers with their name, UUID, identifier, user-description, resource limits, and default port. This does NOT provide real-time online/offline status.',
            parameters: { type: 'object', properties: {} } 
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_specific_server_details_and_status',
            description: 'Get detailed real-time status (running, offline, starting, stopping) and resource usage (CPU, memory, disk) for a SINGLE specific Pterodactyl game server.',
            parameters: {
                type: 'object',
                properties: {
                    serverId: {
                        type: 'string',
                        description: 'The unique identifier (e.g., \'261bf2bb\') or the user-friendly name (e.g., \'My Minecraft Server\') of the server.'
                    },
                },
                required: ['serverId'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_online_status_for_all_servers',
            description: 'Checks and returns the current real-time online/offline status for ALL Pterodactyl game servers. Use this to answer broad questions like "What servers are online?" or "Which servers are running?".',
            parameters: { type: 'object', properties: {} } // No parameters
        },
    },
    {
        type: 'function',
        function: {
            name: 'send_pterodactyl_power_signal',
            description: 'Send a power signal (start, stop, restart, or kill) to a specific Pterodactyl game server.',
            parameters: {
                type: 'object',
                properties: {
                    serverId: {
                        type: 'string',
                        description: 'The unique identifier (e.g., \'261bf2bb\') or the user-friendly name (e.g., \'My Minecraft Server\') of the Pterodactyl server to send the signal to.'
                    },
                    signal: {
                        type: 'string',
                        enum: ['start', 'stop', 'restart', 'kill'],
                        description: 'The power signal to send to the server.'
                    },
                },
                required: ['serverId', 'signal'],
            },
        },
    },
    { // New tool for listing Nests and Eggs
        type: 'function',
        function: {
            name: 'list_available_games_and_types',
            description: 'Lists all available game/application categories (Nests) and the specific server types (Eggs) within them that can be installed or configured.',
            parameters: { type: 'object', properties: {} } // No parameters
        }
    },
    { // New tool for specific Egg details
        type: 'function',
        function: {
            name: 'get_specific_egg_installation_details',
            description: 'Get detailed installation requirements (environment variables, etc.) for a specific game server type (Egg). Provide the Egg name and optionally the Nest (category) name if known.',
            parameters: {
                type: 'object',
                properties: {
                    egg_name: {
                        type: 'string',
                        description: 'The name of the specific Egg (game/server type) to get details for (e.g., \'Vanilla Minecraft\', \'V Rising\').'
                    },
                    nest_name: {
                        type: 'string',
                        description: 'Optional. The name of the Nest (category) the Egg belongs to (e.g., \'Minecraft\', \'Survival Games\'). Helps to disambiguate if multiple Eggs have similar names.'
                    }
                },
                required: ['egg_name']
            }
        }
    },
    { // New tool for server creation
        type: 'function',
        function: {
            name: 'create_pterodactyl_server',
            description: 'Creates a new game server. Requires the server name and the type of game/egg to install. User can optionally provide specific environment variables.',
            parameters: {
                type: 'object',
                properties: {
                    server_name: {
                        type: 'string',
                        description: 'The desired name for the new server.'
                    },
                    egg_name: {
                        type: 'string',
                        description: 'The name of the Egg (game/server type) to install (e.g., \'Vanilla Minecraft\', \'V Rising\').'
                    },
                    nest_name: {
                        type: 'string',
                        description: 'Optional. The name of the Nest (category) the Egg belongs to. Helps disambiguate if multiple Eggs have similar names.'
                    },
                    environment_variables: {
                        type: 'object',
                        description: 'Optional. Key-value pairs of environment variables to set for the server, overriding defaults from the Egg if specified. E.g., { \"SERVER_MOTD\": \"Welcome to my new server!\" }',
                        additionalProperties: { type: 'string' } // Allows any string key-value pairs
                    }
                },
                required: ['server_name', 'egg_name']
            }
        }
    }
];

/**
 * Processes a user's natural language query using the LLM.
 * For now, it just gets a direct response. Tool calling will be added later.
 * 
 * @param discordMessage The full discord.js Message object from the user.
 * @returns The LLM's response as a string, or null if an error occurs or LLM is disabled.
 */
export async function processUserQueryWithLLM(discordMessage: Message): Promise<string | null> {
    // Extract the actual query content, removing the bot mention
    const userQuery = discordMessage.content.replace(/<@!?\\d+>/g, '').trim();
    
    console.log(`VERBOSE_LOG: [LLM Service] Processing query from ${discordMessage.author.tag}: "${userQuery}"`);
    if (!openai) {
        console.log("VERBOSE_LOG: [LLM Service] OpenAI client not initialized. Cannot process LLM query.");
        return "I'm sorry, but my connection to the advanced language model is currently unavailable.";
    }
    if (!userQuery) {
        // This case should ideally be handled in index.ts (empty mention), but as a safeguard:
        return "Hey there! How can I help you manage your servers today?";
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        {
            role: 'system',
            content: 'You are Asuna, a helpful Discord bot managing game servers. \nUse `list_pterodactyl_servers_basic_info` for general server info. \nUse `get_specific_server_details_and_status` for live status of ONE server. \nUse `get_online_status_for_all_servers` for broad online/offline status. \nUse `send_pterodactyl_power_signal` to start/stop/restart servers. \nUse `list_available_games_and_types` to show what can be installed. \nUse `get_specific_egg_installation_details` for setup requirements of a game type. \nUse `create_pterodactyl_server` to create a new server; you MUST ask for a server name and the type of game (Egg). \nIf a tool provides a specific `user_message` in its JSON response, use that message directly for the user. Otherwise, summarize function results. Do not output raw JSON. Confirm important actions.'
        },
        { role: 'user', content: userQuery }, // Use the extracted userQuery
    ];

    try {
        console.log('VERBOSE_LOG: [LLM Service] Sending initial request to OpenAI. Messages:', JSON.stringify(messages, null, 2));
        let response = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo-0125', // Ensure using a model that supports tool calling well
            messages: messages,
            tools: tools,
            tool_choice: 'auto', 
        });
        console.log('VERBOSE_LOG: [LLM Service] Received initial response from OpenAI.');
        let responseMessage = response.choices[0].message;
        console.log('VERBOSE_LOG: [LLM Service] Initial response message from LLM:', JSON.stringify(responseMessage, null, 2));

        let iterationCount = 0;
        const maxIterations = 5; // Safety break for tool call loops

        while (responseMessage.tool_calls && iterationCount < maxIterations) {
            iterationCount++;
            console.log(`VERBOSE_LOG: [LLM Service] Iteration ${iterationCount}. LLM decided to call tool(s):`, JSON.stringify(responseMessage.tool_calls, null, 2));
            messages.push(responseMessage); 

            for (const toolCall of responseMessage.tool_calls) {
                console.log(`VERBOSE_LOG: [LLM Service] Executing tool call: ${toolCall.function.name}, Args: ${toolCall.function.arguments}`);
                const functionName = toolCall.function.name;
                const functionArgs = JSON.parse(toolCall.function.arguments);
                let functionResponseContent = '';
                let actualServerId = '';

                // Common logic to resolve serverId if provided as name for functions that need it
                async function resolveServerId(query: string): Promise<string | null> {
                    const allServers = await listServers();
                    let targetServer: PterodactylServer | undefined = allServers.find((s: PterodactylServer) => s.attributes.identifier === query);
                    if (!targetServer) {
                        const lowerCaseQuery = query.toLowerCase();
                        const matchingByName = allServers.filter((s: PterodactylServer) => s.attributes.name.toLowerCase().includes(lowerCaseQuery));
                        if (matchingByName.length === 1) targetServer = matchingByName[0];
                        else if (matchingByName.length > 1) { 
                            console.log(`VERBOSE_LOG: [LLM Service - resolveServerId] Ambiguous server query: "${query}". Multiple matches found.`);
                            return null; 
                        }
                    }
                    const resolvedId = targetServer ? targetServer.attributes.identifier : null;
                    console.log(`VERBOSE_LOG: [LLM Service - resolveServerId] Query: "${query}", Resolved ID: "${resolvedId}"`);
                    return resolvedId;
                }

                try {
                    if (functionName === 'list_pterodactyl_servers_basic_info') {
                        const servers: PterodactylServer[] = await listServers(); // listServers now includes allocations
                        const simplifiedServers: SimplifiedPterodactylServerInfo[] = servers.map(server => {
                            const defaultAllocation = server.attributes.relationships?.allocations?.data.find(a => a.attributes.is_default);
                            return {
                                name: server.attributes.name,
                                uuid: server.attributes.uuid,
                                identifier: server.attributes.identifier,
                                description: server.attributes.description,
                                limits: server.attributes.limits, // Full limits object
                                default_port: defaultAllocation?.attributes.port
                            };
                        });
                        functionResponseContent = JSON.stringify(simplifiedServers);
                    } else if (functionName === 'get_specific_server_details_and_status') {
                        actualServerId = await resolveServerId(functionArgs.serverId as string) || '';
                        if (actualServerId) {
                            const resources: PterodactylServerResourceState | null = await getServerResources(actualServerId);
                            functionResponseContent = JSON.stringify(resources);
                        } else {
                            functionResponseContent = JSON.stringify({ error: `Server with name or ID '${functionArgs.serverId}' not found or is ambiguous.` });
                        }
                    } else if (functionName === 'get_online_status_for_all_servers') {
                        const statuses: ServerOnlineStatusInfo[] = await getServersWithOnlineStatus();
                        functionResponseContent = JSON.stringify(statuses);
                    } else if (functionName === 'send_pterodactyl_power_signal') {
                        actualServerId = await resolveServerId(functionArgs.serverId as string) || '';
                        const signal = functionArgs.signal as 'start' | 'stop' | 'restart' | 'kill';
                        if (actualServerId) {
                            const success = await sendPowerSignal(actualServerId, signal);
                            functionResponseContent = JSON.stringify({ success: success, serverId: actualServerId, signal: signal });
                        } else {
                            functionResponseContent = JSON.stringify({ error: `Server with name or ID '${functionArgs.serverId}' not found or is ambiguous for power signal.` });
                        }
                    } else if (functionName === 'list_available_games_and_types') { // Handle new function
                        const nests: PterodactylNest[] = await listNestsWithEggs();
                        const simplifiedNests: SimplifiedNestInfo[] = nests.map(nest => ({
                            nest_name: nest.attributes.name,
                            nest_description: nest.attributes.description,
                            available_eggs: nest.attributes.relationships?.eggs?.data.map(egg => ({
                                egg_name: egg.attributes.name,
                                egg_description: egg.attributes.description
                            })) || []
                        }));
                        functionResponseContent = JSON.stringify(simplifiedNests);
                    } else if (functionName === 'get_specific_egg_installation_details') {
                        const eggNameToFind = (functionArgs.egg_name as string).toLowerCase();
                        const nestNameToFind = (functionArgs.nest_name as string | undefined)?.toLowerCase();
                        let foundEgg: PterodactylEgg | null = null;
                        let foundNest: PterodactylNest | null = null;

                        const allNestsWithEggs = await listNestsWithEggs(); 

                        for (const nest of allNestsWithEggs) {
                            if (nestNameToFind && nest.attributes.name.toLowerCase() !== nestNameToFind) {
                                continue; // If nest_name is specified, skip nests that don't match
                            }
                            const egg = nest.attributes.relationships?.eggs?.data.find(e => e.attributes.name.toLowerCase() === eggNameToFind);
                            if (egg) {
                                // To get full egg details including variables, we need its ID and Nest ID
                                foundEgg = await getEggDetails(nest.attributes.id, egg.attributes.id);
                                foundNest = nest;
                                break;
                            }
                            // If nest_name was not specified, and we haven't found the egg yet, keep searching other nests
                        }

                        if (foundEgg && foundNest) {
                            const simplifiedDetails: SimplifiedEggDetails = {
                                egg_name: foundEgg.attributes.name,
                                egg_description: foundEgg.attributes.description,
                                nest_name: foundNest.attributes.name,
                                variables: foundEgg.attributes.relationships?.variables?.data.map(v => ({
                                    name: v.attributes.name,
                                    description: v.attributes.description,
                                    env_variable: v.attributes.env_variable,
                                    default_value: v.attributes.default_value,
                                    is_editable: v.attributes.user_viewable && v.attributes.user_editable
                                })) || []
                            };
                            functionResponseContent = JSON.stringify(simplifiedDetails);
                        } else {
                            let errorMsg = `Could not find an Egg named "${functionArgs.egg_name}"`;
                            if (nestNameToFind) errorMsg += ` in Nest "${functionArgs.nest_name}"`;
                            errorMsg += ". Please ensure the names are correct, or list available games to see valid options.";
                            console.warn(`VERBOSE_LOG: [LLM Service] Failed to find egg details: ${errorMsg}`);
                            functionResponseContent = JSON.stringify({ error: errorMsg });
                        }
                    } else if (functionName === 'create_pterodactyl_server') {
                        const serverName = functionArgs.server_name as string;
                        const eggNameToFind = (functionArgs.egg_name as string).toLowerCase();
                        const nestNameToFind = (functionArgs.nest_name as string | undefined)?.toLowerCase();
                        const userProvidedEnv = functionArgs.environment_variables as Record<string, string> | undefined;

                        if (!PTERO_DEFAULT_OWNER_ID || !PTERO_DEFAULT_NODE_ID) {
                            functionResponseContent = JSON.stringify({ error: 'Bot is not properly configured for server creation (missing default owner or node ID). Please contact the administrator.' });
                        } else {
                            let targetEgg: PterodactylEgg | null = null;
                            let targetNest: PterodactylNest | null = null;
                            const allNestsWithEggs = await listNestsWithEggs();

                            for (const nest of allNestsWithEggs) {
                                if (nestNameToFind && nest.attributes.name.toLowerCase() !== nestNameToFind) continue;
                                const egg = nest.attributes.relationships?.eggs?.data.find(e => e.attributes.name.toLowerCase() === eggNameToFind);
                                if (egg) {
                                    targetEgg = await getEggDetails(nest.attributes.id, egg.attributes.id);
                                    targetNest = nest;
                                    break;
                                }
                            }

                            if (!targetEgg || !targetNest) {
                                let errorMsg = `Could not find Egg "${functionArgs.egg_name}"`;
                                if (nestNameToFind) errorMsg += ` in Nest "${functionArgs.nest_name}"`;
                                errorMsg += ". Cannot create server.";
                                functionResponseContent = JSON.stringify({ error: errorMsg });
                            } else {
                                const availableAllocation = await findAvailableAllocation(PTERO_DEFAULT_NODE_ID!);
                                if (!availableAllocation) {
                                    functionResponseContent = JSON.stringify({ error: `No available IP allocations found on the default node (ID: ${PTERO_DEFAULT_NODE_ID}). Server creation failed.` });
                                } else {
                                    // Prepare environment variables
                                    const finalEnvironment: Record<string, string | number | boolean> = {};
                                    targetEgg.attributes.relationships?.variables?.data.forEach(v => {
                                        finalEnvironment[v.attributes.env_variable] = v.attributes.default_value;
                                    });
                                    if (userProvidedEnv) {
                                        for (const key in userProvidedEnv) {
                                            finalEnvironment[key] = userProvidedEnv[key];
                                        }
                                    }
                                    // For Pterodactyl API, boolean values might need to be "1" or "0", or true/false. Check panel behavior.
                                    // For now, we pass them as is from user or default (which are strings from Egg). String is safer.

                                    const creationOptions: ServerCreationOptions = {
                                        name: serverName,
                                        user: PTERO_DEFAULT_OWNER_ID!,
                                        egg: targetEgg.attributes.id,
                                        docker_image: targetEgg.attributes.docker_image,
                                        startup: targetEgg.attributes.startup,
                                        environment: finalEnvironment,
                                        limits: { memory: 2048, swap: 0, disk: 10240, io: 500, cpu: 100 }, // TODO: Make configurable or Egg-based
                                        feature_limits: { databases: 0, allocations: 1, backups: 1 }, // TODO: Make configurable
                                        allocation: { default: availableAllocation.attributes.id },
                                        start_on_completion: true,
                                    };

                                    const createdServer = await createServer(creationOptions);
                                    if (createdServer) {
                                        // Call the monitor function (fire and forget)
                                        monitorServerInstallationAndStartup(
                                            createdServer.attributes.uuid, // Using UUID for App API calls initially
                                            createdServer.attributes.identifier, // For client API resource checks
                                            createdServer.attributes.name, 
                                            discordMessage
                                        );
                                        functionResponseContent = JSON.stringify({
                                            success: true,
                                            action_description: `Server creation for "${createdServer.attributes.name}" has been successfully initiated. It is now installing.`,
                                            user_message: `I've started the creation process for server "${createdServer.attributes.name}". I will send another message here when it's fully online and ready!`
                                        });
                                    } else {
                                        functionResponseContent = JSON.stringify({ error: 'Server creation process failed at the API level. Check bot logs for details.' });
                                    }
                                }
                            }
                        }
                    } else {
                        console.warn(`VERBOSE_LOG: [LLM Service] LLM tried to call unknown function: ${functionName}`);
                        functionResponseContent = JSON.stringify({ error: `Unknown function: ${functionName}` });
                    }
                    console.log(`VERBOSE_LOG: [LLM Service] Tool ${functionName} executed. Response content length: ${functionResponseContent.length}`);
                } catch (toolError: any) {
                    console.error(`VERBOSE_LOG: [LLM Service] CRITICAL_ERROR executing tool ${functionName}:`, toolError);
                    functionResponseContent = JSON.stringify({ error: `Error executing tool ${functionName}: ${toolError.message || 'Unknown error'}` });
                }

                messages.push({
                    tool_call_id: toolCall.id,
                    role: 'tool',
                    // Name property is removed as it's not part of ChatCompletionToolMessageParam type
                    content: functionResponseContent,
                });
            }

            if (iterationCount >= maxIterations) {
                console.warn('VERBOSE_LOG: [LLM Service] WARNING: Exceeded maximum tool call iterations. Breaking loop.');
                return "I seem to be stuck in a loop trying to figure that out. Could you simplify your request?";
            }

            console.log('VERBOSE_LOG: [LLM Service] Sending function results back to LLM. Messages:', JSON.stringify(messages, null, 2));
            response = await openai.chat.completions.create({
                model: 'gpt-3.5-turbo-0125',
                messages: messages,
                tools: tools,
                tool_choice: 'auto',
            });
            console.log('VERBOSE_LOG: [LLM Service] Received response from LLM after sending tool results.');
            responseMessage = response.choices[0].message;
            console.log('VERBOSE_LOG: [LLM Service] LLM response message after tool call(s):', JSON.stringify(responseMessage, null, 2));
        }

        // Before returning responseMessage.content, check if it's a JSON from our tool with user_message
        if (responseMessage.tool_calls) { // This means the LAST message from LLM was asking to call a tool, so previous was tool result
            // This logic path might be tricky; the LLM should ideally incorporate the tool result into its content.
            // Let's assume the final response from the LLM (after all tool calls) is in responseMessage.content.
            // If the *last* tool call provided a `user_message`, the LLM *should* use it based on the new system prompt.
        } else if (responseMessage.content) { // This is a direct text response from LLM
            // Check if this content itself is a JSON string containing our user_message (less likely path for final message)
            try {
                const potentialToolResponse = JSON.parse(responseMessage.content); // This is unlikely for LLM final content
                if (potentialToolResponse.user_message) {
                    console.log('VERBOSE_LOG: [LLM Service] Using user_message from LLM content (parsed JSON).');
                    return potentialToolResponse.user_message;
                }
            } catch (e) { /* Not a JSON string, proceed as normal */ }
        }

        // The primary logic for the LLM to use the `user_message` will be driven by the system prompt guiding it to look for that field
        // in the tool_response it receives. If the last message from the LLM is a content message (not a tool_call), 
        // it should have already processed the tool_response containing our `user_message`.

        if (responseMessage.content) {
            console.log(`VERBOSE_LOG: [LLM Service] Final LLM response: "${responseMessage.content.trim()}"`);
            return responseMessage.content.trim();
        } else {
            console.error('VERBOSE_LOG: [LLM Service] CRITICAL_ERROR: LLM final response content was empty or in an unexpected format.', JSON.stringify(responseMessage, null, 2));
            return "I processed the information, but I'm having a little trouble phrasing my response.";
        }

    } catch (error: any) {
        console.error('VERBOSE_LOG: [LLM Service] CRITICAL_ERROR during LLM processing (OpenAI API call or other unhandled exception):', error);
        if (error.response) {
            console.error('VERBOSE_LOG: [LLM Service] OpenAI API Error Response Data:', error.response.data);
        }
        return "I encountered an issue while trying to process your request with the language model and its tools.";
    }
}

// New Monitor Function (outside processUserQueryWithLLM)
async function monitorServerInstallationAndStartup(
    serverUuid: string, // For App API calls to check server details
    serverIdentifier: string, // For Client API calls to check resources
    serverName: string, 
    originalMessage: Message
) {
    console.log(`VERBOSE_LOG: [LLM Service Monitor] Starting to monitor server "${serverName}" (UUID: ${serverUuid}, ID: ${serverIdentifier})`);
    const monitoringTimeoutMs = 10 * 60 * 1000; // 10 minutes total timeout
    const initialPollDelayMs = 15 * 1000; // 15 seconds for install status
    const resourcePollDelayMs = 10 * 1000; // 10 seconds for resource status
    const startTime = Date.now();

    try {
        // Phase 1: Wait for installation to complete
        let isStillInstalling = true;
        console.log(`VERBOSE_LOG: [LLM Service Monitor] "${serverName}" - Phase 1: Checking installation status...`);
        while (isStillInstalling && (Date.now() - startTime < monitoringTimeoutMs)) {
            // Using App API to get server details by UUID, as it's more robust immediately after creation
            // The /api/application/servers/{id} endpoint is for the *internal numeric ID*, not UUID or identifier.
            // We might need to list servers and find by UUID if there isn't a direct GET by UUID endpoint, 
            // or use the internal ID if createServer starts returning it consistently.
            // For now, let's assume we need to list or use a client API if it becomes available faster.
            // Let's use listServers and find by UUID for now, it's simpler than relying on internal ID
            const servers = await listServers(); // Client API, might take a moment to show up
            const currentServerData = servers.find(s => s.attributes.uuid === serverUuid);

            if (currentServerData) {
                isStillInstalling = currentServerData.attributes.is_installing;
                if (isStillInstalling) {
                    console.log(`VERBOSE_LOG: [LLM Service Monitor] "${serverName}" is still installing. Waiting ${initialPollDelayMs / 1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, initialPollDelayMs));
                } else {
                    console.log(`VERBOSE_LOG: [LLM Service Monitor] "${serverName}" finished installation phase.`);
                    break; // Exit install check loop
                }
            } else {
                console.log(`VERBOSE_LOG: [LLM Service Monitor] "${serverName}" not yet found in server list. Waiting ${initialPollDelayMs / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, initialPollDelayMs));
            }
            if (Date.now() - startTime >= monitoringTimeoutMs) {
                console.warn(`VERBOSE_LOG: [LLM Service Monitor] "${serverName}" timed out waiting for installation to complete.`);
                if (originalMessage.channel instanceof TextChannel || originalMessage.channel instanceof NewsChannel || originalMessage.channel instanceof ThreadChannel || originalMessage.channel instanceof DMChannel) {
                    await originalMessage.channel.send(`Server "${serverName}" (ID: ${serverIdentifier}) took too long during its installation phase. Please check its status manually.`);
                } else { console.warn(`VERBOSE_LOG: [LLM Service Monitor] Cannot send timeout message to channel type: ${originalMessage.channel.type}`); }
                return;
            }
        }
        if (isStillInstalling) return; // Timed out in inner check

        // Phase 2: Wait for server to be running
        console.log(`VERBOSE_LOG: [LLM Service Monitor] "${serverName}" - Phase 2: Checking resource status for 'running' state...`);
        let serverIsRunning = false;
        while (!serverIsRunning && (Date.now() - startTime < monitoringTimeoutMs)) {
            const resources = await getServerResources(serverIdentifier); // Uses Client API with server short ID
            if (resources) {
                console.log(`VERBOSE_LOG: [LLM Service Monitor] "${serverName}" current state: ${resources.current_state}`);
                if (resources.current_state === 'running') {
                    serverIsRunning = true;
                    console.log(`VERBOSE_LOG: [LLM Service Monitor] "${serverName}" is now RUNNING.`);
                    if (originalMessage.channel instanceof TextChannel || originalMessage.channel instanceof NewsChannel || originalMessage.channel instanceof ThreadChannel || originalMessage.channel instanceof DMChannel) {
                        await originalMessage.channel.send(`🎉 Server "**${serverName}**" (ID: \`${serverIdentifier}\`) is now online and ready!`);
                    } else { console.warn(`VERBOSE_LOG: [LLM Service Monitor] Cannot send success message to channel type: ${originalMessage.channel.type}`); }
                    return;
                } else if (resources.current_state === 'offline') {
                    // Optional: Attempt to start the server if it's offline post-install
                    console.log(`VERBOSE_LOG: [LLM Service Monitor] "${serverName}" is OFFLINE. Attempting to start...`);
                    await sendPowerSignal(serverIdentifier, 'start');
                    // Wait a bit after sending start signal before next poll
                } else if (resources.current_state === 'starting') {
                    console.log(`VERBOSE_LOG: [LLM Service Monitor] "${serverName}" is STARTING. Waiting ${resourcePollDelayMs / 1000}s...`);
                } else {
                    console.log(`VERBOSE_LOG: [LLM Service Monitor] "${serverName}" is in state: ${resources.current_state}. Waiting ${resourcePollDelayMs / 1000}s...`);
                }
            } else {
                console.log(`VERBOSE_LOG: [LLM Service Monitor] "${serverName}" - Could not fetch resources yet. Waiting ${resourcePollDelayMs / 1000}s...`);
            }
            await new Promise(resolve => setTimeout(resolve, resourcePollDelayMs));
            if (Date.now() - startTime >= monitoringTimeoutMs) {
                console.warn(`VERBOSE_LOG: [LLM Service Monitor] "${serverName}" timed out waiting to reach 'running' state.`);
                if (originalMessage.channel instanceof TextChannel || originalMessage.channel instanceof NewsChannel || originalMessage.channel instanceof ThreadChannel || originalMessage.channel instanceof DMChannel) {
                    await originalMessage.channel.send(`Server "${serverName}" (ID: ${serverIdentifier}) was installed but took too long to become fully online. Please check its status manually.`);
                } else { console.warn(`VERBOSE_LOG: [LLM Service Monitor] Cannot send running timeout message to channel type: ${originalMessage.channel.type}`); }
                return;
            }
        }

    } catch (error) {
        console.error(`VERBOSE_LOG: [LLM Service Monitor] CRITICAL_ERROR monitoring server "${serverName}":`, error);
        try {
            if (originalMessage.channel instanceof TextChannel || originalMessage.channel instanceof NewsChannel || originalMessage.channel instanceof ThreadChannel || originalMessage.channel instanceof DMChannel) {
                await originalMessage.channel.send(`An error occurred while monitoring the startup of server "${serverName}". Please check its status manually.`);
            } else { console.warn(`VERBOSE_LOG: [LLM Service Monitor] Cannot send error message to channel type: ${originalMessage.channel.type}`); }
        } catch (discordError) {
            console.error('VERBOSE_LOG: [LLM Service Monitor] Failed to send error message to Discord:', discordError);
        }
    }
} 