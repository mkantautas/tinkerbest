# TinkerBest

A simplified Tinkerwell clone for executing Laravel/PHP code with Docker/Sail support. Built with Tauri for a lightweight native experience.

## Features

- Execute PHP/Laravel code on any Laravel project
- Monaco Editor with PHP syntax highlighting
- Docker/Laravel Sail support with container selection
- Auto-detection of project type (Laravel version, PHP version, Docker/Sail)
- Auto-import of Laravel models (use `User::first()` without full namespace)
- Real-time output display
- Keyboard shortcuts (Cmd+Enter to run)
- macOS native app (~10MB vs ~150MB with Electron)

## Requirements

- [Rust](https://rustup.rs/) (for development)
- Node.js 18+
- For running code:
  - PHP installed locally, OR
  - Docker with Laravel Sail setup

## Installation

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build
```

The built DMG will be in `src-tauri/target/release/bundle/dmg/`.

## Usage

1. Click "Select Project" to choose your Laravel project directory
2. The app will auto-detect:
   - If it's a Laravel project
   - PHP version
   - Docker/Sail availability
   - Running containers
3. Write your PHP/Laravel code in the editor
4. Press `Cmd+Enter` or click "Run" to execute
5. Toggle "Use Docker/Sail" and select a container if needed

## Code Examples

```php
// Models are auto-imported!
$users = User::all();
dump($users->count());

// Database queries
DB::table('users')->first();

// Config values
config('app.name');

// Date/Time
now()->toDateTimeString();

// Eloquent relationships
User::with('posts')->first();
```

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Run code | `Cmd+Enter` |

## Tech Stack

- **Frontend**: Vanilla JS + Monaco Editor
- **Backend**: Rust + Tauri 2.0
- **Bundled size**: ~10MB DMG

## License

MIT
