# DomVerse 🏡

### Smart Hostel Management System

> **DomVerse** is a modern Hostel Management System that digitizes hostel operations by providing a centralized platform for students and administrators. It replaces manual paperwork with an efficient, secure, and user-friendly web application.

---

## Overview

Managing hostel activities manually often leads to delays, paperwork, and communication issues. DomVerse simplifies the entire process by allowing students to submit requests online while enabling administrators to manage approvals and hostel services from a single dashboard.

The goal of DomVerse is to create a smart digital ecosystem that improves efficiency, transparency, and the overall hostel experience.

---

## Key Features

### Student Module

* Secure Login
* Dashboard
* Leave Request
* Gate Pass Request
* Parent Approval
* Room Swap Request
* Holiday Calendar
* Mess Menu
* Feedback Submission
* Track Request Status

### Admin Module

* Secure Admin Login
* Student Management
* Leave Approval
* Gate Pass Approval
* Room Swap Management
* Holiday Management
* Mess Menu Management
* Feedback Management
* Dashboard Overview

---

## Technology Stack

| Category | Technologies                  |
| -------- | ----------------------------- |
| Frontend | HTML5, CSS3, JavaScript       |
| Backend  | Node.js, Express.js           |
| Database | MySQL                         |
| Tools    | Git, GitHub, VS Code, Postman |

---

## Project Structure

```text
DomVerse/
│
├── backend/
│   ├── config/
│   ├── routes/
│   ├── controllers/
│   ├── middleware/
│   ├── data/
│   ├── server.js
│   └── package.json
│
├── frontend/
│   ├── css/
│   ├── js/
│   ├── assets/
│   ├── student pages
│   └── admin pages
│
├── database/
│   └── schema.sql
│
├── README.md
└── .gitignore
```

---

## System Workflow

```text
Student
    │
    ▼
Login
    │
    ▼
Submit Request
    │
    ▼
Backend (Express.js)
    │
    ▼
MySQL Database
    │
    ▼
Admin Dashboard
    │
    ▼
Approve / Reject
    │
    ▼
Status Updated
```

---

## Modules

### Student

* Authentication
* Leave Management
* Gate Pass
* Parent Approval
* Room Swap
* Feedback
* Mess Menu
* Holiday Calendar

### Administrator

* Dashboard
* Student Records
* Leave Approval
* Gate Pass Approval
* Holiday Updates
* Room Swap Approval
* Feedback Monitoring
* Mess Menu Management

---

## Installation

### Clone the Repository

```bash
git clone https://github.com/subitha-Mohanasundaram/DomVerse.git
```

### Navigate to the Project

```bash
cd DomVerse
```

### Install Backend Dependencies

```bash
cd backend
npm install
```

### Start the Server

```bash
npm start
```

### Database Setup

1. Open MySQL.
2. Create a database.
3. Import the `database/schema.sql` file.
4. Update the database configuration in the backend.
5. Restart the server.

---

## Screenshots

Add screenshots of the following pages:

* Home Page
* Student Dashboard
* Admin Dashboard
* Leave Management
* Gate Pass
* Room Swap
* Feedback Page

---

## Future Enhancements

* QR-based Gate Pass
* Email Notifications
* Mobile Application
* AI Hostel Assistant
* Visitor Management
* Attendance Tracking
* Payment Integration
* Analytics Dashboard
* Cloud Deployment

---

## Why DomVerse?

* Digital hostel management
* Reduced paperwork
* Faster approval process
* Centralized information
* Better communication
* Secure access
* Easy to maintain
* Scalable architecture

---

## Author

**Subitha Mohanasundaram**

B.Tech – Information Technology

GitHub: https://github.com/subitha-Mohanasundaram

---

## License

This project is developed for educational and portfolio purposes.

---

### If you found this project useful, consider giving it a ⭐ on GitHub.
