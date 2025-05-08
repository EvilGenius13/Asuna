import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const PTERO_API_URL = process.env.PTERODACTYL_API_URL;
const PTERO_CLIENT_KEY = process.env.PTERODACTYL_CLIENT_API_KEY;

if (!PTERO_API_URL || !PTERO_CLIENT_KEY) {
    console.error('CRITICAL: Pterodactyl API URL or Client Key not found in .env file.');
    // We don't exit here, as the bot might have other functionalities
    // But functions relying on Pterodactyl will fail.
}

const apiClient = axios.create({
    baseURL: PTERO_API_URL,
    headers: {
        'Authorization': `Bearer ${PTERO_CLIENT_KEY}`,
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
    if (!PTERO_API_URL || !PTERO_CLIENT_KEY) {
        console.error("Pterodactyl API credentials not configured. Cannot list servers.");
        return []; // Or throw an error
    }
    try {
        const response = await apiClient.get<PterodactylListResponse>('/api/client');
        return response.data.data; // The actual list of server objects
    } catch (error: any) {
        if (axios.isAxiosError(error)) {
            console.error(
                'Error fetching Pterodactyl servers:',
                error.response?.status,
                error.response?.data
            );
        } else {
            console.error('An unexpected error occurred while fetching Pterodactyl servers:', error);
        }
        return []; // Or throw an error
    }
}

/**
 * Fetches the current resource state of a specific server.
 * See: https://dashflo.net/docs/api/pterodactyl/v1/client/servers/get-server-utilization/
 * @param serverId The identifier of the server (e.g., "261bf2bb")
 */
export async function getServerResources(serverId: string): Promise<PterodactylServerResourceState | null> {
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
        return response.data.attributes;
    } catch (error: any) {
        if (axios.isAxiosError(error)) {
            console.error(
                `Error fetching resources for server ${serverId}:`,
                error.response?.status,
                error.response?.data
            );
        } else {
            console.error(`An unexpected error occurred while fetching resources for server ${serverId}:`, error);
        }
        return null;
    }
} 