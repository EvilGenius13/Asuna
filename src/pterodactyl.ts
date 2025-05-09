import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const PTERO_API_URL = process.env.PTERODACTYL_API_URL;
const PTERO_CLIENT_KEY = process.env.PTERODACTYL_CLIENT_API_KEY;
const PTERO_APP_KEY = process.env.PTERODACTYL_APP_API_KEY;
const PTERO_DEFAULT_OWNER_ID = process.env.PTERODACTYL_DEFAULT_OWNER_ID;
const PTERO_DEFAULT_NODE_ID = process.env.PTERODACTYL_DEFAULT_NODE_ID;

if (!PTERO_API_URL || !PTERO_CLIENT_KEY) {
    console.error('CRITICAL: Pterodactyl API URL or Client Key not found in .env file.');
    // We don't exit here, as the bot might have other functionalities
    // But functions relying on Pterodactyl Client API will fail.
}

if (!PTERO_APP_KEY) {
    console.warn('WARNING: Pterodactyl Application API Key not found in .env file. Egg/Server creation & listing will not work.');
    // Functions relying on Pterodactyl Application API will fail.
}

if (!PTERO_DEFAULT_OWNER_ID) {
    console.warn('WARNING: Pterodactyl Default Owner ID not found in .env file. Server creation may fail or use panel default.');
}

if (!PTERO_DEFAULT_NODE_ID) {
    console.warn('WARNING: Pterodactyl Default Node ID not found in .env file. Server creation will fail as it cannot find allocations.');
}

const apiClient = axios.create({
    baseURL: PTERO_API_URL,
    headers: {
        'Authorization': `Bearer ${PTERO_CLIENT_KEY}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    },
});

// New Axios client for Application API
const appApiClient = axios.create({
    baseURL: PTERO_API_URL,
    headers: {
        'Authorization': `Bearer ${PTERO_APP_KEY}`, // Use the Application API Key
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    },
});

export interface PterodactylServer {
    object: 'server';
    attributes: {
        identifier: string;
        uuid: string;
        name: string;
        node: string;
        sftp_details: {
            ip: string;
            port: number;
        };
        description: string;
        limits: {
            memory: number;
            swap: number;
            disk: number;
            io: number;
            cpu: number;
        };
        feature_limits: {
            databases: number;
            allocations: number;
            backups: number;
        };
        is_suspended: boolean;
        is_installing: boolean;
        is_transferring: boolean;
        server_owner: boolean;
        status: string | null; // e.g., running, offline, starting, stopping
        invocation?: string; // Only for reinstalled/imported servers
        relationships?: {
            allocations?: {
                object: string;
                data: Array<{
                    object: string;
                    attributes: {
                        id: number;
                        ip: string;
                        ip_alias: string | null;
                        port: number; 
                        notes: string | null;
                        is_default: boolean;
                    };
                }>;
            };
        };
    };
}

interface PterodactylListResponse {
    object: 'list';
    data: PterodactylServer[];
    meta: {
        pagination: {
            total: number;
            count: number;
            per_page: number;
            current_page: number;
            total_pages: number;
        };
    };
}

export interface PterodactylServerResourceState {
    current_state: 'running' | 'offline' | 'starting' | 'stopping';
    is_suspended: boolean;
    resources: {
        memory_bytes: number;
        cpu_absolute: number; // CPU usage in percentage * 100 (e.g., 50.5% is 5050)
        disk_bytes: number;
        network_rx_bytes: number;
        network_tx_bytes: number;
        uptime: number; // in milliseconds
    };
}

interface PterodactylResourceResponse {
    object: 'stats';
    attributes: PterodactylServerResourceState;
}

/**
 * Fetches the list of all servers accessible by the API key.
 * See: https://dashflo.net/docs/api/pterodactyl/v1/client/servers/list-servers/
 */
export async function listServers(): Promise<PterodactylServer[]> {
    console.log("VERBOSE_LOG: [Pterodactyl Service] Attempting to list servers...");
    if (!PTERO_API_URL || !PTERO_CLIENT_KEY) {
        console.error("VERBOSE_LOG: [Pterodactyl Service] CRITICAL_ERROR: Pterodactyl API credentials not configured. Cannot list servers.");
        return []; 
    }
    try {
        const response = await apiClient.get<PterodactylListResponse>('/api/client?include=allocations');
        console.log(`VERBOSE_LOG: [Pterodactyl Service] Successfully listed ${response.data.data.length} servers.`);
        return response.data.data; 
    } catch (error: any) {
        console.error('VERBOSE_LOG: [Pterodactyl Service] CRITICAL_ERROR fetching Pterodactyl servers:', error.isAxiosError ? { status: error.response?.status, data: error.response?.data } : error);
        return []; 
    }
}

/**
 * Fetches the current resource state of a specific server.
 * See: https://dashflo.net/docs/api/pterodactyl/v1/client/servers/get-server-utilization/
 * @param serverId The identifier of the server (e.g., "261bf2bb")
 */
export async function getServerResources(serverId: string): Promise<PterodactylServerResourceState | null> {
    console.log(`VERBOSE_LOG: [Pterodactyl Service] Attempting to get resources for server ID: ${serverId}`);
    if (!PTERO_API_URL || !PTERO_CLIENT_KEY) {
        console.error("Pterodactyl API credentials not configured. Cannot get server resources.");
        return null;
    }
    if (!serverId) {
        console.error("Server ID is required to get server resources.");
        return null;
    }
    try {
        const response = await apiClient.get<PterodactylResourceResponse>(`/api/client/servers/${serverId}/resources`);
        console.log(`VERBOSE_LOG: [Pterodactyl Service] Successfully fetched resources for server ID: ${serverId}`);
        return response.data.attributes;
    } catch (error: any) {
        console.error(`VERBOSE_LOG: [Pterodactyl Service] CRITICAL_ERROR fetching resources for server ${serverId}:`, error.isAxiosError ? { status: error.response?.status, data: error.response?.data } : error);
        return null;
    }
}

/**
 * Sends a power signal to a specific server.
 * See: https://dashflo.net/docs/api/pterodactyl/v1/client/servers/send-power-action/
 * @param serverId The identifier of the server.
 * @param signal The power signal to send: "start", "stop", "restart", or "kill".
 * @returns True if the signal was sent successfully (API returns 204 No Content), false otherwise.
 */
export async function sendPowerSignal(serverId: string, signal: 'start' | 'stop' | 'restart' | 'kill'): Promise<boolean> {
    console.log(`VERBOSE_LOG: [Pterodactyl Service] Attempting to send power signal '${signal}' to server ID: ${serverId}`);
    if (!PTERO_API_URL || !PTERO_CLIENT_KEY) {
        console.error("Pterodactyl API credentials not configured. Cannot send power signal.");
        return false;
    }
    if (!serverId) {
        console.error("Server ID is required to send a power signal.");
        return false;
    }
    if (!['start', 'stop', 'restart', 'kill'].includes(signal)) {
        console.error(`Invalid power signal: ${signal}. Must be one of start, stop, restart, kill.`);
        return false;
    }

    try {
        await apiClient.post(`/api/client/servers/${serverId}/power`, { signal: signal });
        // Pterodactyl API returns a 204 No Content on success for this endpoint
        console.log(`VERBOSE_LOG: [Pterodactyl Service] Power signal '${signal}' sent successfully to server ${serverId}.`);
        return true;
    } catch (error: any) {
        console.error(`VERBOSE_LOG: [Pterodactyl Service] CRITICAL_ERROR sending power signal '${signal}' to server ${serverId}:`, error.isAxiosError ? { status: error.response?.status, data: error.response?.data } : error);
        return false;
    }
}

// New interface for the combined status information
export interface ServerOnlineStatusInfo {
    name: string;
    identifier: string;
    current_state: string | null; // Real-time status from resources endpoint
    default_port?: number;
}

/**
 * Fetches all servers and their real-time online/offline status and default port.
 * This is more resource-intensive as it calls the resources endpoint for each server.
 */
export async function getServersWithOnlineStatus(): Promise<ServerOnlineStatusInfo[]> {
    console.log("VERBOSE_LOG: [Pterodactyl Service] Attempting to get online status for all servers...");
    if (!PTERO_API_URL || !PTERO_CLIENT_KEY) {
        console.error("Pterodactyl API credentials not configured. Cannot get detailed server statuses.");
        return [];
    }

    const allServersRaw = await listServers(); // listServers now includes allocations
    if (!allServersRaw || allServersRaw.length === 0) {
        console.log("[Pterodactyl Service] No servers found when trying to get online statuses.");
        return [];
    }
    console.log(`VERBOSE_LOG: [Pterodactyl Service] Found ${allServersRaw.length} servers. Fetching individual statuses...`);

    const statusInfoList: ServerOnlineStatusInfo[] = [];

    for (let i = 0; i < allServersRaw.length; i++) {
        const server = allServersRaw[i];
        console.log(`VERBOSE_LOG: [Pterodactyl Service] Getting status for server ${i+1}/${allServersRaw.length}: ${server.attributes.name} (${server.attributes.identifier})`);
        const resources = await getServerResources(server.attributes.identifier);
        const defaultAllocation = server.attributes.relationships?.allocations?.data.find(a => a.attributes.is_default);

        statusInfoList.push({
            name: server.attributes.name,
            identifier: server.attributes.identifier,
            current_state: resources ? resources.current_state : 'unknown', // Use real-time status
            default_port: defaultAllocation?.attributes.port
        });
    }
    console.log(`VERBOSE_LOG: [Pterodactyl Service] Finished fetching all online statuses. Count: ${statusInfoList.length}`);
    return statusInfoList;
}

/**
 * Fetches all Nests and their associated Eggs using the Application API.
 * See: https://pterodactyl.io/application-api/endpoints/nests.html#list-nests
 * and https://pterodactyl.io/application-api/endpoints/eggs.html (for includes)
 */
export async function listNestsWithEggs(): Promise<PterodactylNest[]> {
    console.log("VERBOSE_LOG: [Pterodactyl Service AppAPI] Attempting to list all Nests with their Eggs...");
    if (!PTERO_API_URL || !PTERO_APP_KEY) {
        console.error("VERBOSE_LOG: [Pterodactyl Service AppAPI] CRITICAL_ERROR: Pterodactyl API URL or Application Key not configured. Cannot list Nests/Eggs.");
        return [];
    }
    try {
        // Using ?include=eggs to get eggs along with nests
        const response = await appApiClient.get<PterodactylAppListResponse<PterodactylNest>>('/api/application/nests?include=eggs');
        const nestsWithEggs = response.data.data;
        console.log(`VERBOSE_LOG: [Pterodactyl Service AppAPI] Successfully listed ${nestsWithEggs.length} Nests.`);
        
        // Optional: Log details about fetched eggs for verification
        nestsWithEggs.forEach(nest => {
            const eggCount = nest.attributes.relationships?.eggs?.data.length || 0;
            console.log(`VERBOSE_LOG: [Pterodactyl Service AppAPI] Nest "${nest.attributes.name}" (ID: ${nest.attributes.id}) has ${eggCount} egg(s).`);
        });

        return nestsWithEggs;
    } catch (error: any) {
        console.error('VERBOSE_LOG: [Pterodactyl Service AppAPI] CRITICAL_ERROR fetching Nests with Eggs:', error.isAxiosError ? { status: error.response?.status, data: error.response?.data } : error);
        return [];
    }
}

export interface PterodactylEggVariable {
    object: 'egg_variable';
    attributes: {
        name: string;
        description: string;
        env_variable: string;
        default_value: string;
        user_viewable: boolean;
        user_editable: boolean;
        rules: string;
        // Potentially more fields like 'sort', 'options' for dropdowns
    };
}
export interface PterodactylEgg {
    object: 'egg';
    attributes: {
        id: number;
        uuid: string;
        nest: number; // ID of the nest it belongs to
        author: string;
        name: string;
        description: string | null;
        docker_image: string;
        startup: string;
        // config section (files, startup, stop, logs, etc.)
        // script section (install, update)
        created_at: string;
        updated_at: string | null;
        relationships?: {
            variables?: { // If included
                object: 'list';
                data: PterodactylEggVariable[];
            };
        };
    };
}

export interface PterodactylNest {
    object: 'nest';
    attributes: {
        id: number;
        uuid: string;
        author: string;
        name: string;
        description: string | null;
        created_at: string;
        updated_at: string | null;
        relationships?: { // If eggs are included
            eggs?: {
                object: 'list';
                data: PterodactylEgg[];
            };
        };
    };
}

interface PterodactylAppListResponse<T> { // Generic for App API list responses
    object: 'list';
    data: T[];
    meta: {
        pagination: {
            total: number;
            count: number;
            per_page: number;
            current_page: number;
            total_pages: number;
        };
    };
}

/**
 * Fetches details for a specific Egg, including its variables, using the Application API.
 * See: https://pterodactyl.io/application-api/endpoints/eggs.html#get-a-single-egg
 * @param nestId The numeric ID of the Nest.
 * @param eggId The numeric ID of the Egg.
 */
export async function getEggDetails(nestId: number, eggId: number): Promise<PterodactylEgg | null> {
    console.log(`VERBOSE_LOG: [Pterodactyl Service AppAPI] Attempting to get details for Egg ID: ${eggId} in Nest ID: ${nestId}...`);
    if (!PTERO_API_URL || !PTERO_APP_KEY) {
        console.error("VERBOSE_LOG: [Pterodactyl Service AppAPI] CRITICAL_ERROR: Pterodactyl API URL or Application Key not configured. Cannot get Egg details.");
        return null;
    }
    if (!nestId || !eggId) {
        console.error("VERBOSE_LOG: [Pterodactyl Service AppAPI] Nest ID and Egg ID are required to get Egg details.");
        return null;
    }

    try {
        // Using ?include=variables to get the egg's variables
        const response = await appApiClient.get<{ object: 'egg', attributes: PterodactylEgg['attributes'] }>(`/api/application/nests/${nestId}/eggs/${eggId}?include=variables`);
        // The direct response for a single egg is typically just the attributes object under an object wrapper.
        // We reconstruct a PterodactylEgg like object for consistency, though the API might return it slightly differently for single object vs list.
        // For now, let's assume the structure is { object: 'egg', attributes: { ... } }
        // And PterodactylEgg interface expects attributes within an attributes property.
        // Let's adjust to directly return response.data which should be PterodactylEgg compatible if it returns the full object.
        // If it returns just the attributes, we might need to wrap it. Pterodactyl docs sometimes show this.
        // Let's assume the response is directly the PterodactylEgg object itself (which has 'object' and 'attributes')
        const eggDetails = response.data as PterodactylEgg; // Casting, assuming the API returns the full PterodactylEgg structure

        console.log(`VERBOSE_LOG: [Pterodactyl Service AppAPI] Successfully fetched details for Egg "${eggDetails.attributes.name}". Variables count: ${eggDetails.attributes.relationships?.variables?.data.length || 0}.`);
        return eggDetails;
    } catch (error: any) {
        console.error(`VERBOSE_LOG: [Pterodactyl Service AppAPI] CRITICAL_ERROR fetching details for Egg ID ${eggId} in Nest ID ${nestId}:`, error.isAxiosError ? { status: error.response?.status, data: error.response?.data } : error);
        return null;
    }
}

// Interface for Pterodactyl Allocation
export interface PterodactylAllocation {
    object: 'allocation';
    attributes: {
        id: number;
        ip: string;
        ip_alias: string | null;
        port: number;
        notes: string | null;
        assigned: boolean; // True if a server is currently assigned to this allocation
    };
}

/**
 * Finds an available (unassigned) allocation on a specified node.
 * See: https://pterodactyl.io/application-api/endpoints/nodes.html#list-allocations
 * @param nodeId The numeric ID of the Node.
 * @returns A PterodactylAllocation object if one is found, otherwise null.
 */
export async function findAvailableAllocation(nodeId: number): Promise<PterodactylAllocation | null> {
    console.log(`VERBOSE_LOG: [Pterodactyl Service AppAPI] Attempting to find an available allocation on Node ID: ${nodeId}...`);
    if (!PTERO_API_URL || !PTERO_APP_KEY) {
        console.error("VERBOSE_LOG: [Pterodactyl Service AppAPI] CRITICAL_ERROR: Pterodactyl API URL or Application Key not configured. Cannot find allocations.");
        return null;
    }
    if (!nodeId) {
        console.error("VERBOSE_LOG: [Pterodactyl Service AppAPI] Node ID is required to find an allocation.");
        return null;
    }

    try {
        const response = await appApiClient.get<PterodactylAppListResponse<PterodactylAllocation>>(`/api/application/nodes/${nodeId}/allocations`);
        const allocations = response.data.data;
        
        const availableAllocation = allocations.find(alloc => !alloc.attributes.assigned);

        if (availableAllocation) {
            console.log(`VERBOSE_LOG: [Pterodactyl Service AppAPI] Found available allocation: ID ${availableAllocation.attributes.id} (${availableAllocation.attributes.ip}:${availableAllocation.attributes.port}) on Node ID: ${nodeId}.`);
            return availableAllocation;
        } else {
            console.warn(`VERBOSE_LOG: [Pterodactyl Service AppAPI] WARNING: No available allocations found on Node ID: ${nodeId}.`);
            return null;
        }
    } catch (error: any) {
        console.error(`VERBOSE_LOG: [Pterodactyl Service AppAPI] CRITICAL_ERROR fetching allocations for Node ID ${nodeId}:`, error.isAxiosError ? { status: error.response?.status, data: error.response?.data } : error);
        return null;
    }
}

// Interface for Server Creation Payload
export interface ServerCreationOptions {
    name: string;
    user: number; // Owner ID
    egg: number; // Egg ID
    docker_image: string; 
    startup: string;
    environment: Record<string, string | number | boolean>; // Egg variables
    limits: {
        memory: number; // MB
        swap: number;   // MB (0 recommended, -1 for unlimited)
        disk: number;   // MB
        io: number;     // 10-1000; 500 is default
        cpu: number;    // % (100 = 1 core)
    };
    feature_limits: {
        databases: number; // Max number of databases
        allocations: number; // Max number of network allocations (ports)
        backups: number;     // Max number of backups
    };
    allocation: {
        default: number; // ID of the primary allocation for the server
        // additional?: number[]; // Optional: Array of additional allocation IDs
    };
    // description?: string; // Optional description for the server
    start_on_completion?: boolean; // Default true, start server after install script
    // skip_scripts?: boolean; // Default false, whether to skip egg install script
    // oom_disabled?: boolean; // Default true for most eggs
}

/**
 * Creates a new server on Pterodactyl using the Application API.
 * See: https://pterodactyl.io/application-api/endpoints/servers.html#create-a-new-server
 * @param options The configuration options for the new server.
 * @returns The created PterodactylServer object if successful, otherwise null.
 */
export async function createServer(options: ServerCreationOptions): Promise<PterodactylServer | null> {
    console.log(`VERBOSE_LOG: [Pterodactyl Service AppAPI] Attempting to create server "${options.name}"...`);
    if (!PTERO_API_URL || !PTERO_APP_KEY) {
        console.error("VERBOSE_LOG: [Pterodactyl Service AppAPI] CRITICAL_ERROR: Pterodactyl API URL or Application Key not configured. Cannot create server.");
        return null;
    }

    // Basic validation of required options
    if (!options.name || !options.user || !options.egg || !options.docker_image || !options.startup || !options.allocation?.default) {
        console.error("VERBOSE_LOG: [Pterodactyl Service AppAPI] CRITICAL_ERROR: Missing critical options for server creation.", options);
        return null;
    }

    try {
        const payload: ServerCreationOptions = {
            name: options.name,
            user: options.user,
            egg: options.egg,
            docker_image: options.docker_image,
            startup: options.startup,
            environment: options.environment || {},
            limits: options.limits || { memory: 2048, swap: 0, disk: 10240, io: 500, cpu: 100 }, // Default limits
            feature_limits: options.feature_limits || { databases: 0, allocations: 1, backups: 0 }, // Default feature limits
            allocation: { default: options.allocation.default },
            start_on_completion: options.start_on_completion !== undefined ? options.start_on_completion : true,
            // description: options.description || '',
        };

        console.log("VERBOSE_LOG: [Pterodactyl Service AppAPI] Server creation payload:", JSON.stringify(payload, null, 2));

        const response = await appApiClient.post<PterodactylServer>('/api/application/servers', payload);
        
        // The response for server creation should be the full server object (type PterodactylServer)
        console.log(`VERBOSE_LOG: [Pterodactyl Service AppAPI] Successfully created server "${response.data.attributes.name}" (ID: ${response.data.attributes.identifier}, UUID: ${response.data.attributes.uuid}).`);
        return response.data; // This should be the PterodactylServer object

    } catch (error: any) {
        console.error(`VERBOSE_LOG: [Pterodactyl Service AppAPI] CRITICAL_ERROR creating server "${options.name}":`, 
            error.isAxiosError ? 
            { 
                status: error.response?.status, 
                data: error.response?.data, 
                config: { // Log relevant parts of the request config like URL and method
                    url: error.config?.url,
                    method: error.config?.method,
                    headers: error.config?.headers, // Be careful with sensitive headers if any
                    data: error.config?.data // This would be the payload we sent
                }
            } : 
            error
        );
        // Log detailed validation errors if available (Pterodactyl often returns these in errors[0].detail)
        if (error.response?.data?.errors) {
            console.error("VERBOSE_LOG: [Pterodactyl Service AppAPI] Validation Errors:", JSON.stringify(error.response.data.errors, null, 2));
        }
        return null;
    }
} 