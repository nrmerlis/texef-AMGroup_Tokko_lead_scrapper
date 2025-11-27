# Use Node.js with Playwright pre-installed
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/

# Set environment variables
ENV NODE_ENV=production
ENV HEADLESS=true

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/leads/health || exit 1

# Run the application
CMD ["node", "src/index.js"]

