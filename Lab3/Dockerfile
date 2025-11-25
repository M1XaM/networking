FROM node:latest

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 8080

CMD ["npm", "start", "8080", "boards/perfect.txt"]
# CMD ["npm", "test"]

# For simulation:
# Run the server first, then ...
# npm run simulation http://localhost:8080 boards/large.txt