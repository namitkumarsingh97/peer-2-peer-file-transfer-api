import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors());
app.use(express.json());

// Store active rooms and users
const rooms = new Map();
const users = new Map();

// No authentication needed - open file sharing

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Join a room (file transfer session)
  socket.on('join-room', ({ roomId, username }) => {
    socket.join(roomId);
    users.set(socket.id, { username, roomId, socketId: socket.id });
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        users: [],
        createdAt: new Date()
      });
    }
    
    const room = rooms.get(roomId);
    if (!room.users.find(u => u.socketId === socket.id)) {
      room.users.push({ socketId: socket.id, username });
    }
    
    socket.to(roomId).emit('user-joined', { username, socketId: socket.id });
    io.to(roomId).emit('room-users', room.users);
    
    console.log(`User ${username} joined room ${roomId}`);
  });

  // WebRTC signaling - offer
  socket.on('offer', ({ offer, roomId, targetSocketId }) => {
    socket.to(targetSocketId).emit('offer', {
      offer,
      fromSocketId: socket.id,
      fromUsername: users.get(socket.id)?.username
    });
  });

  // WebRTC signaling - answer
  socket.on('answer', ({ answer, roomId, targetSocketId }) => {
    socket.to(targetSocketId).emit('answer', {
      answer,
      fromSocketId: socket.id,
      fromUsername: users.get(socket.id)?.username
    });
  });

  // WebRTC signaling - ICE candidate
  socket.on('ice-candidate', ({ candidate, targetSocketId }) => {
    socket.to(targetSocketId).emit('ice-candidate', {
      candidate,
      fromSocketId: socket.id
    });
  });

  // Chat messages
  socket.on('chat-message', ({ roomId, message, username }) => {
    io.to(roomId).emit('chat-message', {
      message,
      username,
      timestamp: new Date().toISOString()
    });
  });

  // File transfer metadata
  socket.on('file-metadata', ({ roomId, fileName, fileSize, fileType, targetSocketId }) => {
    socket.to(targetSocketId).emit('file-metadata', {
      fileName,
      fileSize,
      fileType,
      fromSocketId: socket.id,
      fromUsername: users.get(socket.id)?.username
    });
  });

  // File transfer progress
  socket.on('file-progress', ({ targetSocketId, progress, fileName }) => {
    socket.to(targetSocketId).emit('file-progress', {
      progress,
      fileName,
      fromSocketId: socket.id
    });
  });

  // File transfer complete
  socket.on('file-complete', ({ targetSocketId, fileName }) => {
    socket.to(targetSocketId).emit('file-complete', {
      fileName,
      fromSocketId: socket.id
    });
  });

  // Direct file sharing - announce file availability (broadcast to all)
  socket.on('file-share-announce', ({ fileId, metadata, seederSocketId }) => {
    // Broadcast file availability to all connected users
    socket.broadcast.emit('file-share-announce', {
      fileId,
      metadata,
      seederSocketId: socket.id
    });
  });

  // Stop sharing file
  socket.on('file-share-stop', ({ fileId }) => {
    socket.broadcast.emit('file-share-stop', { fileId });
  });

  // File download request (WebRTC signaling)
  socket.on('file-download-request', ({ offer, fileId, targetSocketId }) => {
    socket.to(targetSocketId).emit('file-download-request', {
      offer,
      fileId,
      fromSocketId: socket.id
    });
  });

  // File download answer (WebRTC signaling)
  socket.on('file-download-answer', ({ answer, fileId, targetSocketId }) => {
    socket.to(targetSocketId).emit('file-download-answer', {
      answer,
      fileId,
      fromSocketId: socket.id
    });
  });

  // File download connect (request file info)
  socket.on('file-download-connect', ({ fileId }) => {
    // Broadcast to find the seeder
    socket.broadcast.emit('file-download-connect', {
      fileId,
      downloaderSocketId: socket.id
    });
  });

  // Leave room
  socket.on('leave-room', ({ roomId }) => {
    socket.leave(roomId);
    const user = users.get(socket.id);
    if (user) {
      const room = rooms.get(roomId);
      if (room) {
        room.users = room.users.filter(u => u.socketId !== socket.id);
        if (room.users.length === 0) {
          rooms.delete(roomId);
        } else {
          io.to(roomId).emit('room-users', room.users);
        }
      }
      socket.to(roomId).emit('user-left', { username: user.username });
    }
    console.log(`User ${socket.userId} left room ${roomId}`);
  });

  // Disconnect
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      const room = rooms.get(user.roomId);
      if (room) {
        room.users = room.users.filter(u => u.socketId !== socket.id);
        if (room.users.length === 0) {
          rooms.delete(user.roomId);
        } else {
          io.to(user.roomId).emit('room-users', room.users);
          socket.to(user.roomId).emit('user-left', { username: user.username });
        }
      }
    }
    users.delete(socket.id);
    console.log(`User disconnected: ${socket.userId}`);
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});

