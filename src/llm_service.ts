import OpenAI from 'openai';
import dotenv from 'dotenv';
import { listServers, getServerResources, PterodactylServer, PterodactylServerResourceState } from './pterodactyl'; // Import actual functions

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
    console.warn('WARNING: OpenAI API Key not found in .env file. LLM functionalities will be disabled.');
}

// Initialize OpenAI client only if the key exists
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// Define the tools (our Pterodactyl functions) the LLM can use
const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
        type: 'function',
        function: {
            name: 'list_pterodactyl_servers',
            description: 'Get a list of all available Pterodactyl game servers and their basic status (e.g., running, offline). Useful for questions like "What servers are online?" or "List all my servers.".',
            parameters: { type: 'object', properties: {} } // No parameters for listServers
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_pterodactyl_server_resources',
            description: 'Get detailed resource usage (CPU, memory, disk, network, current status) for a specific Pterodactyl game server. Use this if the user asks for the status or details of a particular server by its name or ID.',
            parameters: {
                type: 'object',
                properties: {
                    serverId: {
                        type: 'string',
                        description: 'The unique identifier (e.g., \'261bf2bb\') or the user-friendly name (e.g., \'My Minecraft Server\') of the Pterodactyl server. If using a name, it should be specific enough if multiple servers exist.'
                    },
                },
                required: ['serverId'],
            },
        },
    },
    // Future functions (like start_server, stop_server) can be added here
];

/**
 * Processes a user's natural language query using the LLM.
 * For now, it just gets a direct response. Tool calling will be added later.
 * 
 * @param userQuery The natural language query from the user.
 * @returns The LLM's response as a string, or null if an error occurs or LLM is disabled.
 */
export async function processUserQueryWithLLM(userQuery: string): Promise<string | null> {
    if (!openai) {
        console.log("OpenAI client not initialized. Cannot process LLM query.");
        return "I'm sorry, but my connection to the advanced language model is currently unavailable.";
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        {
            role: 'system',
            content: 'You are Asuna, a helpful Discord bot assistant managing game servers via the Pterodactyl panel. When asked about server details or lists, use the provided functions to get up-to-date information. Be concise and friendly. If a server name is provided by the user, pass that name as the serverId parameter to the relevant function if it requires it. When using functions that return server data, summarize the key information for the user rather than just outputting raw JSON.'
        },
        { role: 'user', content: userQuery },
    ];

    try {
        let response = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo-0125', // Ensure using a model that supports tool calling well
            messages: messages,
            tools: tools,
            tool_choice: 'auto', 
        });

        let responseMessage = response.choices[0].message;

        while (responseMessage.tool_calls) {
            console.log('[LLM Service] LLM decided to call a tool(s):', responseMessage.tool_calls);
            messages.push(responseMessage); 

            for (const toolCall of responseMessage.tool_calls) {
                const functionName = toolCall.function.name;
                const functionArgs = JSON.parse(toolCall.function.arguments);
                let functionResponseContent = '';
                let actualServerId = '';

                if (functionName === 'list_pterodactyl_servers') {
                    const servers: PterodactylServer[] = await listServers();
                    functionResponseContent = JSON.stringify(servers);
                } else if (functionName === 'get_pterodactyl_server_resources') {
                    const serverQuery = functionArgs.serverId as string;
                    const allServers: PterodactylServer[] = await listServers();
                    let targetServer: PterodactylServer | undefined = allServers.find((s: PterodactylServer) => s.attributes.identifier === serverQuery);
                    if (!targetServer) {
                        const lowerCaseQuery = serverQuery.toLowerCase();
                        const matchingByName = allServers.filter((s: PterodactylServer) => s.attributes.name.toLowerCase().includes(lowerCaseQuery));
                        if (matchingByName.length === 1) targetServer = matchingByName[0];
                        // If multiple matches, LLM should ideally be prompted to ask user for clarification in next turn, 
                        // or we return an ambiguous result for now.
                        // For simplicity here, we'll pick the first if multiple, or proceed if it resolved.
                        if (matchingByName.length > 0 && !targetServer) targetServer = matchingByName[0]; 
                    }

                    if (targetServer) {
                        actualServerId = targetServer.attributes.identifier;
                        const resources: PterodactylServerResourceState | null = await getServerResources(actualServerId);
                        functionResponseContent = JSON.stringify(resources);
                    } else {
                        functionResponseContent = JSON.stringify({ error: `Server with name or ID '${serverQuery}' not found or is ambiguous.` });
                    }
                } else {
                    console.warn(`[LLM Service] LLM tried to call unknown function: ${functionName}`);
                    functionResponseContent = JSON.stringify({ error: `Unknown function: ${functionName}` });
                }

                messages.push({
                    tool_call_id: toolCall.id,
                    role: 'tool',
                    // Name property is removed as it's not part of ChatCompletionToolMessageParam type
                    content: functionResponseContent,
                });
            }

            console.log('[LLM Service] Sending function results back to LLM.');
            response = await openai.chat.completions.create({
                model: 'gpt-3.5-turbo-0125',
                messages: messages,
                tools: tools,
                tool_choice: 'auto',
            });
            responseMessage = response.choices[0].message;
        }

        if (responseMessage.content) {
            return responseMessage.content.trim();
        } else {
            console.error('[LLM Service] LLM final response content was empty or in an unexpected format.', responseMessage);
            return "I processed the information, but I'm having a little trouble phrasing my response.";
        }

    } catch (error) {
        console.error('[LLM Service] Error during LLM processing or tool call:', error);
        return "I encountered an issue while trying to process your request with the language model and its tools.";
    }
} 