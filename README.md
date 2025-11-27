# Tokko Lead Scraper

API service para extraer leads de Tokko Broker CRM usando Playwright y OpenAI.

## 🚀 Características

- ✅ Login automático en Tokko Broker
- ✅ Navegación a la sección de leads/oportunidades
- ✅ Scraping de leads con scroll infinito
- ✅ Filtrado por estado (pendiente, en proceso, etc.)
- ✅ Extracción de detalles de propiedad (ID, agente)
- ✅ API REST para integración
- ✅ Docker ready para deployment

## 📋 Requisitos

- Node.js >= 18
- Una cuenta de OpenAI (API Key)
- Credenciales de Tokko Broker

## ⚙️ Configuración

1. **Clonar e instalar dependencias:**

```bash
npm install
```

2. **Configurar variables de entorno:**

Crear un archivo `.env` en la raíz del proyecto:

```env
# OpenAI Configuration (for smart selectors)
OPENAI_API_KEY=your_openai_api_key_here

# Tokko Broker Credentials
TOKKO_EMAIL=your_email@example.com
TOKKO_PASSWORD=your_password_here

# Server Configuration
PORT=3000
NODE_ENV=development

# Scraper Configuration
HEADLESS=true
SLOW_MO=0
```

3. **Instalar browsers de Playwright:**

```bash
npx playwright install chromium
```

## 🏃 Ejecución

### Modo desarrollo

```bash
npm run dev
```

### Modo producción

```bash
npm start
```

## 📡 API Endpoints

### POST `/api/leads/scrape`

Inicia un trabajo de scraping.

**Request body:**
```json
{
  "targetDate": "2024-01-01",
  "status": "para_reasignacion",
  "maxLeads": 100,
  "extractDetails": true
}
```

| Campo | Tipo | Requerido | Default | Descripción |
|-------|------|-----------|---------|-------------|
| `targetDate` | string | ✅ | - | Fecha límite (YYYY-MM-DD). Deja de scrapear al llegar a leads más antiguos |
| `status` | string | ❌ | `pendiente_contactar` | Estado de leads a filtrar (ver opciones abajo) |
| `maxLeads` | number | ❌ | `10000` | Máximo de leads a scrapear |
| `extractDetails` | boolean | ❌ | `false` | Si extraer email, teléfono y celular del contacto (más lento pero más datos) |

**Opciones de `status`:**

| Valor | Descripción |
|-------|-------------|
| `para_reasignacion` | Leads pendientes de asignar a un agente |
| `sin_seguimiento` | Leads sin seguimiento activo |
| `pendiente_contactar` | Leads pendientes de primer contacto **(default)** |
| `esperando_respuesta` | Leads esperando respuesta del cliente |
| `evolucionando` | Leads en proceso de evolución/negociación |
| `tomar_accion` | Leads que requieren acción inmediata |
| `congelado` | Leads congelados/pausados |
| `all` | Todos los leads sin filtrar por estado |

**Response:**
```json
{
  "success": true,
  "data": {
    "leads": [
      {
        "contact": {
          "name": "Juan Pérez",
          "email": "juan@email.com",
          "phone": "+541112345678",
          "cellPhone": "+5491112345678"
        },
        "agent": {
          "name": "María García"
        },
        "property": {
          "id": "AAP123456",
          "address": "Colombres 148 2"
        },
        "lastUpdated": "15/01/2024 10:30",
        "scrapedAt": "2024-01-20T10:30:00.000Z"
      }
    ],
    "metadata": {
      "scrapedAt": "2024-01-20T10:30:00.000Z",
      "targetDate": "2024-01-01T00:00:00.000Z",
      "totalLeads": 150
    }
  }
}
```

**Ejemplo curl:**
```bash
curl -X POST http://localhost:3000/api/leads/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "targetDate": "2024-01-01",
    "status": "pendiente_contactar",
    "extractDetails": true
  }'
```

### GET `/api/leads/health`

Health check del servicio.

**Response:**
```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2024-01-20T10:30:00.000Z"
}
```

## 🐳 Docker

### Build y run con Docker

```bash
docker build -t tokko-scraper .
docker run -p 3000:3000 --env-file .env tokko-scraper
```

### Con Docker Compose

```bash
docker-compose up -d
```

## ☁️ Deployment en AWS

### Opción 1: EC2

1. Crear instancia EC2 (t3.medium recomendado)
2. Instalar Docker
3. Clonar repo y configurar `.env`
4. `docker-compose up -d`

### Opción 2: ECS Fargate

1. Crear ECR repository
2. Push de la imagen Docker
3. Crear Task Definition con las variables de entorno
4. Crear Service en ECS

### Opción 3: Lambda (limitado)

⚠️ No recomendado para scraping largo debido al límite de 15 minutos.

## 🔧 Personalización

Las queries de selección inteligente están en `src/scraper/queries.js`. Si la estructura de Tokko Broker cambia, modifica las queries ahí.

## ⚠️ Consideraciones

- **Rate limiting**: El scraper incluye delays para no saturar el servidor
- **Sesión**: Las cookies se cachean automáticamente para evitar login repetidos
- **Errores**: Revisa los logs para debugging (`npm run dev` para logs detallados)

## 📁 Estructura del Proyecto

```
├── src/
│   ├── api/
│   │   ├── routes/
│   │   │   └── leads.js         # Endpoints de la API
│   │   └── server.js            # Express server
│   ├── config/
│   │   └── index.js             # Configuración
│   ├── scraper/
│   │   ├── auth.js              # Login y sesión
│   │   ├── leads.js             # Scraping de leads
│   │   ├── queries.js           # Queries de selección
│   │   ├── smart-selector.js    # Selector inteligente con OpenAI
│   │   └── index.js             # Orquestador principal
│   ├── utils/
│   │   └── logger.js            # Winston logger
│   └── index.js                 # Entry point
├── Dockerfile
├── docker-compose.yml
├── package.json
└── README.md
```

## 📝 Licencia

ISC
