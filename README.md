# Ganesh International Order Tracker

A modern, React-based order tracking application for seafood export business operations. Built with React 18, Tailwind CSS, and real-time Gmail integration capabilities.

## Features

### Dashboard
- Real-time order statistics overview
- Active orders pipeline visualization
- Quick access to all modules
- Email-synced order updates

### Order Management
- **8-Stage Lifecycle Tracking**: PO Sent → PI Issued → Artwork OK → QC Done → Scheduled → Docs OK → Final Docs → DHL Sent
- Clickable stage filters with order counts
- Expandable email history for each order
- Search and filter functionality

### Pages
- **Active Orders**: Pipeline view with stage-based filtering
- **Completed Orders**: Delivered orders with DHL/Telex tracking
- **Inquiries**: Manage incoming and outgoing product inquiries
- **Contacts**: Organized contact directory (Buyers, Suppliers, Inspectors)
- **Products**: Product catalog with order statistics

### Email Integration
- Automatic order stage detection from email subjects
- Contact identification from email addresses
- Attachment tracking
- Full email thread history per order

## Tech Stack

- **Frontend**: React 18 (CDN)
- **Styling**: Tailwind CSS
- **Icons**: Custom SVG components (Lucide-style)
- **Fonts**: Inter (Google Fonts)

## Getting Started

Simply open `index.html` in a modern web browser. No build process required.

```bash
# Or serve with any static server
python3 -m http.server 8080
```

Then visit `http://localhost:8080`

## Project Structure

```
ganesh-order-tracker/
├── index.html      # Main application (single-file React app)
├── README.md       # This file
└── .gitignore      # Git ignore rules
```

## Order Stages

| Stage | Name | Description |
|-------|------|-------------|
| 1 | PO Sent | Purchase Order received/sent |
| 2 | PI Issued | Proforma Invoice issued |
| 3 | Artwork OK | Artwork approved by buyer |
| 4 | QC Done | Quality check completed |
| 5 | Scheduled | Vessel schedule confirmed |
| 6 | Docs OK | Draft documents approved |
| 7 | Final Docs | Final document copies sent |
| 8 | DHL Sent | Documents shipped via DHL |

## Contacts

The system tracks various contact types:
- **Buyers**: PESCADOS E.GUILLEM (Mª Carmen Martínez, Oscar García, Salva)
- **Suppliers**: Nila Exports, RAUNAQ, JJ Seafoods, Silver Sea Foods
- **Inspectors**: Hansel Fernandez, J B Boda & Co

## License

Private - Ganesh International

---

Built with ❤️ for Ganesh International
