import fetch, { Response } from 'node-fetch';
import { Readable } from 'stream';

export interface HttpResponse {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Map<string, string>;
    body?: NodeJS.ReadableStream;
    json(): Promise<unknown>;
    text(): Promise<string>;
}

export interface HttpOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
    stream?: boolean;
}

export async function httpRequest(urlString: string, options: HttpOptions = {}): Promise<HttpResponse> {
    const controller = new AbortController();
    const timeoutId = options.timeout ? setTimeout(() => controller.abort(), options.timeout) : null;

    try {
        const response = await fetch(urlString, {
            method: options.method || 'GET',
            headers: options.headers,
            body: options.body,
            signal: controller.signal
        });

        if (timeoutId) {
            clearTimeout(timeoutId);
        }

        const headers = new Map<string, string>();
        response.headers.forEach((value, key) => {
            headers.set(key, value);
        });

        return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers,
            body: options.stream ? response.body as NodeJS.ReadableStream : undefined,
            json: async () => options.stream ? 
                Promise.reject(new Error('Cannot parse JSON from stream')) : 
                response.json(),
            text: async () => options.stream ? 
                Promise.reject(new Error('Cannot get text from stream')) : 
                response.text()
        };
    } catch (error) {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        throw error;
    }
}