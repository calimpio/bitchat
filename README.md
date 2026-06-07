# BitChat - Sovereign Cryptographic Terminal

Terminal de mensajería **soberana y privada** que utiliza criptografía SHA-256 y redes P2P directas. BitChat no utiliza servidores centrales; toda la inteligencia y los datos residen exclusivamente en tu terminal.

Esta versión ha sido modernizada a una arquitectura **TypeScript Local-First** con un pipeline de automatización para escritorio.

## 🚀 Características Principales

### 1. Soberanía de Identidad
- **Sin Servidores**: No hay base de datos central. Tu identidad es un par de claves criptográficas generadas localmente.
- **Identidad Numérica**: Los usuarios se identifican únicamente por su ID Público, eliminando metadatos innecesarios.
- **Protección Anti-Secuestro**: Sistema de validación en red que impide que un tercero reclame tu ID Público.

### 2. Privacidad Extrema
- **Handshake Criptográfico**: Intercambio automático de credenciales para establecer canales seguros únicos.
- **Privacidad de Nickname**: Los nicknames son locales y privados.
- **Control Total**: Borrado permanente de datos locales (Wipe) y eliminación de chats.

### 3. Sincronización P2P
- **Sincronización Segura**: Transfiere contactos y mensajes entre tus propios dispositivos mediante desafíos criptográficos directos.

## 🛠 Arquitectura Técnica

El proyecto se divide en una arquitectura moderna de frontend TypeScript y un contenedor nativo para Windows:

### Frontend (TypeScript + Vite)
- **Local-First SDK**: Lógica modular en `src/sdk/` para base de datos (IndexedDB), autenticación y networking P2P (PeerJS/WebRTC).
- **Componentes UI**: Sistema ligero de micro-componentes funcionales en `src/components/ui/`.
- **Estado Global**: Gestión de estado tipado en `src/sdk/models/state.ts`.
- **Vite**: Bundler ultra-rápido para desarrollo y producción.

### Contenedor Windows (.NET 8)
- **WebView2**: Integración nativa del motor de Chrome para ejecutar el frontend.
- **Virtual Hosting**: Mapeo de archivos locales a un dominio seguro (`https://bitchat.local`).

## 📁 Estructura del Proyecto

- `src/`: Código fuente de la aplicación TypeScript.
  - `sdk/`: Servicios de Red, DB y Auth.
  - `components/`: UI reutilizable.
  - `pages/`: Vistas de la aplicación.
- `windows/`: Proyecto .NET y herramientas de automatización.
  - `www/`: Build de producción de la web para la terminal.
  - `manifests/`: Manifiestos de instalación para WinGet.
  - `sync.cjs`: Script de sincronización de assets.
  - `build.cjs`: Pipeline de compilación y actualización de manifiestos.

## 🛠 Desarrollo y Build

### Requisitos
- Node.js (v18+)
- .NET 8 SDK (para la versión de escritorio)

### Comandos de Frontend
```bash
npm install      # Instalar dependencias
npm run dev      # Servidor de desarrollo (Vite)
npm run build    # Compilar frontend (TypeScript -> JS)
```

### Comandos de Windows (Desktop)
```bash
# 1. Sincronizar el build web con la carpeta de Windows
npm run sync-windows

# 2. Compilar ejecutable, empaquetar ZIP y actualizar manifiestos WinGet
npm run build-windows-64
```

## 📦 Instalación

### WinGet
```powershell
winget install BitChat
```

---
*Desarrollado por Calimpio - "Tu terminal, tu soberanía."*
