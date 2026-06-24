# bitOS - Sistema Operativo Criptográfico Soberano y Local-First

**bitOS** es una plataforma y entorno de ejecución local-first, privado y soberano. Utiliza criptografía de grado militar (SHA-256, ECDH P-384, AES-GCM) y redes punto a punto (P2P directas mediante WebRTC) para garantizar la total propiedad de la identidad, los datos y las comunicaciones. **Sin servidores centrales; toda la inteligencia y los datos residen exclusivamente en tus terminales.**

Esta versión consolida el ecosistema en un entorno TypeScript Local-First modular y automatizado con soporte nativo para escritorio.

---

### 🌐 Demo y Acceso Rápido
Puedes abrir la terminal soberana en producción directamente desde tu navegador en el siguiente enlace de GitHub Pages:
👉 **[Abrir bitOS Standalone Terminal (bitos.html)](https://calimpio.github.io/bitos/bitos.html)**

---

## 🚀 Arquitectura del Ecosistema

El ecosistema de **bitOS** está compuesto por módulos especializados que interactúan a través de un SDK unificado:

```
                  ┌──────────────────────────────────────────────┐
                  │                 bitOS Core                   │
                  │   (Vault, RAM Purge, Auto-Lock, IndexedDB)   │
                  └──────┬──────────────┬──────────────┬─────────┘
                         │              │              │
        ┌────────────────▼──┐    ┌──────▼──────┐    ┌──▼────────────────┐
        │      bitMsg       │    │  bitDevices │    │     bitDrive      │
        │ (Mensajería E2EE) │    │  & bitcli   │    │  (Git P2P Dist)   │
        └───────────────────┘    └─────────────┘    └───────────────────┘
```

### 1. bitOS Core (Plataforma y Seguridad)
- **Bóveda Criptográfica (Vault)**: Protege las claves privadas y metadatos sensibles localmente mediante derivación de clave master con PBKDF2 y cifrado AES-256-GCM.
- **Purga de RAM y Auto-Bloqueo**: Para mitigar ataques en memoria, el sistema purga claves criptográficas de la RAM y bloquea la terminal tras periodos de inactividad programables o tiempos límites absolutos.
- **Identidad Criptográfica Autónoma**: Tu identidad no depende de cuentas ni correos, es un par de claves ECDH generadas localmente. El sistema cuenta con validación en red distribuida para impedir el secuestro de identidades (`IDENTITY_PROBE`).

### 2. bitMsg (Mensajería Soberana)
*Antes conocido como bitChat*, es el módulo principal de comunicación punto a punto:
- **Handshake Criptográfico**: Intercambio de credenciales en red para la derivación del secreto compartido mediante algoritmo ECDH (P-384) e inicio de canal seguro directo.
- **Canales Cifrados E2EE**: Mensajes cifrados extremo a extremo empleando AES-GCM con claves temporales.
- **Cola de Mensajes Offline**: Si el destinatario está desconectado, los mensajes se encolan localmente y se replican de forma automática e idempotente en cuanto ambos nodos estén online.
- **Control de Privacidad**: Gestión de lista negra de contactos, borrado permanente del historial de chats local (Wipe) y revocación de accesos directos.

### 3. bitDrive (Control de Versiones y Almacenamiento P2P)
Un sistema de almacenamiento de archivos y control de versiones distribuido tipo Git implementado enteramente sobre IndexedDB y WebRTC:
- **Repositorios y Versionado**: Creación de repositorios locales, registro histórico de Commits (mensaje, timestamp, autor, hash del árbol raíz).
- **Ramas (Branches)**: Soporte completo para crear ramas en caliente y alternar entre ellas en el espacio de trabajo.
- **Editor y CRUD de Archivos**: Editor de archivos integrado con capacidad de crear, renombrar, editar y eliminar ficheros en caliente sobre el área de trabajo (Working Directory).
- **Colaboración P2P y Pull Requests (PRs)**:
  - Creación de Pull Requests P2P directos entre ramas.
  - Herramienta de visualización de diferencias línea a línea (diffs) que muestra archivos añadidos, modificados o eliminados.
  - Sistema de comentarios criptográficos directamente sobre los Pull Requests.
  - Fusión de ramas (Merge) e integración directa.
- **Clonación Remota**: Permite buscar y clonar de forma directa repositorios alojados en cualquiera de tus terminales personales autorizadas.

### 4. bitDevices & bitcli (Orquestación y Consola)
- **Inventario de Terminales**: Vinculación y monitorización del estado de conexión de todos tus dispositivos bajo una única identidad.
- **Acceso por Llave (Key Access Code)**: Protocolo seguro que permite vincular terminales sin entorno gráfico (como la interfaz de consola **bitcli**) mediante un código PIN y puerto autogenerados (formato `BC-XXXXXX-PPPPP`). La terminal CLI abre un endpoint de enlace HTTP en un puerto local aleatorio de 5 dígitos para la transferencia de credenciales cifradas.
- **Permisos de Replicación Granulares**: Control total sobre qué dispositivos tienen permiso para replicar qué chats, permitiendo establecer réplicas globales o sincronizaciones selectivas.

---

## 🛠️ Contenedor de Escritorio (Windows)

El cliente nativo para Windows se integra de manera fluida con la web app de **bitOS**:
- **WebView2**: Ejecuta la lógica web con el motor de renderizado de Chromium en un contenedor liviano y native-like.
- **Virtual Hosting Mapped**: Mapea directamente la compilación local al dominio seguro `https://bitos.local` impidiendo la inyección externa de recursos (cumpliendo con CSP estricto).
- **Pipeline Automatizado**: Scripts de empaquetado nativo y generación automática de manifiestos Winget de tipo portable actualizados con el checksum SHA256 correspondiente.

---

## 📁 Estructura del Proyecto

```
bitos/
├── src/                      # Código fuente TypeScript del Frontend
│   ├── sdk/                  # Servicios de nivel de sistema y base de datos
│   │   ├── models/           # Definiciones de tipo, esquemas de bitDrive y Vault
│   │   ├── services/         # Lógica de Peer, Auth (Master Key), DB y Criptografía
│   │   └── index.ts          # Inicializador y punto de exportación
│   ├── store/                # Estado reactivo global de bitOS (Zustand)
│   ├── components/           # Componentes modulares de React
│   │   ├── ui/               # Botones, entradas de texto, modales y tarjetas
│   │   └── views/            # Vistas (ChatView, DriveView, DevicesView, SettingsView)
│   └── pages/                # Estructuras de login (Auth.tsx) y dashboard principal
├── cli/                      # Cliente CLI para Terminal (bitcli)
│   └── src/                  # Código TypeScript para bitcli (Identity, Login, Export)
├── windows/                  # Proyecto nativo .NET 8 para Windows
│   └── manifests/            # Manifiestos Winget para la distribución automática
├── bitos.html                # Frontend inyectado compilado autocontenido (Standalone)
├── single.cjs                # Script de inlining CSS/JS para bitos.html
└── package.json              # Configuración de dependencias y scripts de construcción
```

---

## 🚀 Guía de Construcción y Ejecución

### Requisitos Previos
- **Node.js** (v18+)
- **.NET 8 SDK** (Requerido solo para compilar el cliente de escritorio en Windows)

### 1. Construcción del Frontend y CLI
Instala las dependencias y compila los paquetes:
```bash
# Instalar dependencias globales del proyecto
npm install

# Iniciar servidor de desarrollo en caliente (Vite - Puerto 3000)
npm run dev

# Compilar proyecto a archivos estáticos (dist/)
npm run build

# Construir el bundle standalone de bitOS (bitos.html)
npm run build-single
```

Para el cliente de consola **bitcli**:
```bash
cd cli
npm install
npm run build   # Compila TypeScript a JavaScript en cli/dist/
```

### 2. Construcción de la Aplicación de Escritorio
Sincroniza y compila el contenedor nativo:
```bash
# Sincroniza los assets compilados con la carpeta del contenedor
npm run sync-windows

# Compila el ejecutable nativo en Release, crea el ZIP y actualiza los manifiestos Winget
npm run build-windows-64
```
El archivo ZIP resultante se creará en `windows/bitOS_v1.0.0.zip` y el ejecutable autoportable se generará bajo `windows/publish_64/bitOS.exe`.

---

## 🔒 Estándares de Seguridad
1. **Zero-Knowledge Persistence**: El servidor PeerJS se utiliza únicamente como señalizador de red (signaling) WebRTC; no almacena identidades, mensajes ni metadatos de las comunicaciones.
2. **Double-Encryption Barrier**: Los mensajes se cifran en tránsito con el secreto ECDH derivado del handshake E2EE. Una vez recibidos, se vuelven a cifrar utilizando la clave derivada del Master Password del usuario (`aesKey`) antes de ser guardados en la base de datos local `bitmsg_db`.
3. **RAM Purge Protection**: Todas las variables que guardan secretos (como `masterPassword` y `aesKey`) en el estado global Zustand son vaciadas inmediatamente cuando se bloquea el terminal o cuando se supera el temporizador de inactividad.

---
*Desarrollado por Calimpio - "Tu terminal, tu soberanía."*
