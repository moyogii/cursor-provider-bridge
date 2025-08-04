# Cursor Provider Bridge Extension

A Cursor extension that integrates local language models with the Cursor IDE Chat through secure ngrok tunneling.

**Note**: This extension is specifically designed for local development environments with supported LLM providers (Ollama, LM Studio). It's important to note that each chat request will first be processed by Cursor's servers before being forwarded to your locally hosted language model. You are responsible for ensuring compliance with the terms of service and licensing agreements associated with both their chosen models and the Cursor platform.

## Features

- 🚀 **One-Click Integration**: Install extension and start using local models immediately
- 📊 **Visual Status**: Status bar indicators and detailed status information
- ⚙️ **Easy Configuration**: Intuitive settings UI for all ngrok tunneling parameters
- 🔄 **Auto-Start**: Optional automatic startup when Cursor opens
- 🌐 **Cross-Platform**: Works on Windows, macOS, and Linux

## Prerequisites

- **Cursor IDE**
- **Node.js** (bundled with VSCode)

## Installation

### From VSIX Package
1. Download the latest `.vsix` file from releases
2. Install in Cursor: `cursor --install-extension cursor-provider-bridge-1.0.0.vsix`
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
  - Please include detailed information about your environment (OS, VSCode version, Node.js version) when reporting issues.
  - For feature requests, describe the functionality you'd like to see and why it would be valuable.
---