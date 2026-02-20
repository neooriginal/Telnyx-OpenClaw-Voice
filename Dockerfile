# Use Node.js Alpine base
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application source
COPY . .

# Expose port (matches default PORT in index.js)
EXPOSE 3000

# Start application
CMD ["node", "index.js"]
