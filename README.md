<p align="center">
<img width="128" height="128" alt="icon" src="https://github.com/user-attachments/assets/0b55f7f9-31cf-4a08-9114-efd4f49e9a41" />
</p>

# Cursor Provider Bridge

A Cursor extension that integrates local AI model providers with the Cursor IDE Chat through secure ngrok tunneling.

**Note**: This extension was created for local development environments to test local LLM providers (Ollama, LM Studio) with Cursor. It's important to note that each chat request will first be processed by Cursor's servers before being forwarded to your locally hosted language model. **You** are responsible for ensuring compliance with the terms of service and licensing agreements associated with chosen models and the Cursor platform.

## Demo
https://github.com/user-attachments/assets/be68c13d-622c-41c8-a88e-06a9baaba598

## Features

- 🤖 **Local Model Integration**: Bridges the Cursor editor chat window to local providers (Ollama, LM Studio) allowing the use of open source models like Qwen3, GPT-OSS, and more.
- 🎯 **Intuitive Setup**: Easy to configure with guided setup wizard for first-time users
- 📊 **Visual Status**: Status bar indicators and detailed status information
- 🔄 **Auto-Start**: Optional automatic startup when Cursor opens
- 🌐 **Cross-Platform**: Works on Windows, macOS, and Linux

## Prerequisites

- **Cursor IDE**
- **Node.js** (bundled with Cursor)

## Installation

### From VSIX Package
1. Download the latest `.vsix` file from releases
2. Install in Cursor: `cursor --install-extension cursor-provider-bridge-0.1.0.vsix`
3. Or use Cursor UI: Extensions → "..." → Install from VSIX

### From Source
1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run compile` to build the extension
4. Press `F5` to open Extension Development Host for testing

## Development

### Building from Source

```bash
# Clone repository
git clone https://github.com/moyogii/cursor-provider-bridge
cd cursor-provider-bridge

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Lint code
npm run lint

# Package extension
npm run package
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/improvement`)
3. Make your changes
4. Commit your changes (`git commit -am 'Add new feature'`)
5. Push to the branch (`git push origin feature/improvement`)
6. Create a Pull Request

## Support

### Issue Reporting
- **GitHub Issues**: Report bugs or request features through our [GitHub issue tracker](https://github.com/moyogii/cursor-provider-bridge/issues).
  - Please include detailed information about your environment (OS, Cursor version, Node.js version) when reporting issues.
  - For feature requests, describe the functionality you'd like to see and why it would be valuable.
---
