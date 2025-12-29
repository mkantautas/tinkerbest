# TinkerBest

A simplified Tinkerwell clone for executing Laravel/PHP code with Docker/Sail support.

## Features

- Execute PHP/Laravel code on any Laravel project
- Monaco Editor with PHP syntax highlighting
- Docker/Laravel Sail support
- Auto-detection of project type (Laravel version, PHP version, Docker/Sail)
- Real-time output display
- Keyboard shortcuts (Cmd+Enter to run)
- macOS native app with Apple Silicon (M4) support

## Installation

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Or just start the app
npm start
```

## Building for macOS

```bash
# Build for both Intel and Apple Silicon
npm run build:mac

# Build specifically for Apple Silicon (M4/M3/M2/M1)
npm run build:mac-arm
```

The built app will be in the `dist/` folder.

## Usage

1. Click "Select Project" to choose your Laravel project directory
2. The app will auto-detect:
   - If it's a Laravel project
   - PHP version
   - Docker/Sail availability
   - If Sail containers are running
3. Write your PHP/Laravel code in the editor
4. Press `Cmd+Enter` or click "Run" to execute
5. Toggle "Use Docker/Sail" if you want to run code inside Docker containers

## Requirements

- Node.js 18+
- npm or yarn
- For development: Electron
- For running code:
  - PHP installed locally, OR
  - Docker with Laravel Sail setup

## Code Examples

```php
// Get all users
$users = \App\Models\User::all();
dump($users->count());

// Database queries
DB::table('users')->first();

// Config values
config('app.name');

// Date/Time
now()->toDateTimeString();

// Eloquent relationships
\App\Models\User::with('posts')->first();
```

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Run code | `Cmd+Enter` |

## License

MIT
