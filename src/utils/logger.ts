import * as vscode from 'vscode';
import { Logger } from '../types';

export class ExtensionLogger implements Logger {
    private readonly outputChannel: vscode.OutputChannel;
    private readonly isDebugMode: boolean;

    constructor(channelName: string = 'Cursor Model Bridge') {
        this.outputChannel = vscode.window.createOutputChannel(channelName);
        this.isDebugMode = process.env.NODE_ENV === 'development';
    }

    info(message: string, ...args: unknown[]): void {
        this.log('INFO', message, ...args);
    }

    warn(message: string, ...args: unknown[]): void {
        this.log('WARN', message, ...args);
    }

    error(message: string, error?: unknown): void {
        const errorDetails = error instanceof Error 
            ? `${error.message}\n${error.stack}`
            : String(error);
        
        this.log('ERROR', message, errorDetails);
    }

    debug(message: string, ...args: unknown[]): void {
        if (this.isDebugMode) {
            this.log('DEBUG', message, ...args);
        }
    }

    private log(level: string, message: string, ...args: unknown[]): void {
        const timestamp = new Date().toISOString();
        const formattedArgs = args.length > 0 
            ? ` ${args.map(arg => this.formatArg(arg)).join(' ')}`
            : '';
        
        const logMessage = `[${timestamp}] ${level}: ${message}${formattedArgs}`;
        
        this.outputChannel.appendLine(logMessage);
        
        if (this.isDebugMode) {
            console.log(logMessage);
        }
    }

    private readonly SENSITIVE_FIELDS = new Set([
        'password', 'token', 'auth', 'secret', 'key', 'credential', 
        'authorization', 'authtoken', 'ngrokauthtoken', 'apikey', 
        'api_key', 'accesstoken', 'access_token', 'refreshtoken', 
        'refresh_token', 'privatekey', 'private_key'
    ]);

    private sanitizeObject(obj: any, depth = 0): any {
        if (depth > 10) {
            return '[Max depth reached]';
        }
        
        if (obj === null || obj === undefined) {
            return obj;
        }
        if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
            return obj;
        }
        
        if (Array.isArray(obj)) {
            return obj.map(item => this.sanitizeObject(item, depth + 1));
        }
        
        if (typeof obj === 'object') {
            const sanitized: any = {};
            for (const [key, value] of Object.entries(obj)) {
                const lowerKey = key.toLowerCase();
                if (this.SENSITIVE_FIELDS.has(lowerKey) || lowerKey.includes('password') || lowerKey.includes('token')) {
                    sanitized[key] = value ? '[REDACTED]' : value;
                } else {
                    sanitized[key] = this.sanitizeObject(value, depth + 1);
                }
            }
            return sanitized;
        }
        
        return obj;
    }

    private formatArg(arg: unknown): string {
        if (typeof arg === 'string') {
            return arg.replace(/token[=:\s]+[^\s]+/gi, 'token=[REDACTED]');
        } else if (arg instanceof Error) {
            const sanitizedMessage = arg.message.replace(/token[=:\s]+[^\s]+/gi, 'token=[REDACTED]');
            return `${arg.name}: ${sanitizedMessage}`;
        } else if (typeof arg === 'object' && arg !== null) {
            try {
                const sanitized = this.sanitizeObject(arg);
                return JSON.stringify(sanitized, null, 2);
            } catch {
                return String(arg);
            }
        }
        return String(arg);
    }

    show(): void {
        this.outputChannel.show();
    }

    dispose(): void {
        this.outputChannel.dispose();
    }
}

// Singleton logger instance
let loggerInstance: ExtensionLogger | null = null;

export function getLogger(): ExtensionLogger {
    if (!loggerInstance) {
        loggerInstance = new ExtensionLogger();
    }
    return loggerInstance;
}

export function disposeLogger(): void {
    if (loggerInstance) {
        loggerInstance.dispose();
        loggerInstance = null;
    }
}