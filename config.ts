// API Configuration
// Use environment variable or fallback to local development

/// <reference types="vite/client" />

export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5176';

console.log('[Config] API_BASE:', API_BASE); // Debug log

// Helper function to build API URLs
export function buildApiUrl(path: string): string {
    // Remove leading slash if present to avoid double slashes
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    return `${API_BASE}/${cleanPath}`;
}

// Helper function to build WebSocket URLs
export function buildWsUrl(path: string): string {
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    const wsBase = API_BASE.replace(/^http/, 'ws');
    return `${wsBase}/${cleanPath}`;
}
