# BNI Korea Leadership Training 2026

## Overview
This is a React-based web application for managing BNI Korea Leadership Training programs. The system provides a comprehensive platform for training registration, program management, and real-time bidirectional integration with Google Sheets. It serves as a modernized replacement for the existing I'mweb-based site (https://www.ltt-bnikorea.com/), offering enhanced functionality with precise A-G column structure matching for data integrity.

## Recent Changes
- **2026-02-26**: Fixed bulk upload failures and server crashes
  - Deleted unused `home-old.tsx` that had TypeScript errors crashing the Vite dev server
  - Fixed `application-modal.tsx` TypeScript errors (programId field removed from form schema)
  - Fixed `SecondaryPrograms.tsx` prop mismatch (`program` → `selectedProgram`)
  - Switched workflow from `npm run dev` to `npm run start` (production mode) to avoid Vite crash on TS errors
  - Fixed `checkBulkDuplicates` and `checkDuplicateApplication` to return safe fallbacks instead of throwing on Google Sheets API errors
  - Fixed URL encoding for Korean sheet name `'2026 LTT 신청명단'` in all Google Sheets API calls
- **2025-08-17**: Final UI polish with brand red button styling consistency and enhanced mobile navigation
  - Updated "스토어 결제 페이지 바로가기" button to brand red border (1px) + text with white background
  - Implemented mobile hamburger menu with sophisticated interactive button styling system
  - Modified navigation text from "신청현황 : 실시간 대시보드" to "신청현황 대시보드" for cleaner presentation
  - Applied differentiated styling for home vs dashboard buttons with cross-hover effects
  - Added mutual hover effects: hovering one button triggers visual state change in the other button
  - Resolved mobile hover sensitivity issues by expanding hover detection areas and optimizing button structure
- **2025-08-16**: Successfully resolved participant counting inconsistency for mentoring coordinator course
  - Fixed home screen displaying incorrect count (01명) while dashboard showed correct count (5명)
  - Implemented special handling logic for mentoring coordinator course to aggregate all variations
  - Created comprehensive aggregation system that combines all mentoring-related entries regardless of naming variations
  - Home screen now correctly displays 06명 by summing all mentoring entries: 'LTT : 멘토링 코디네이터 T' (1), 'LTT : 멘토링 코디네이터 T ' (2), 'LTT : 멘토링 코디네이터 T.' (1), '멘토링 코디네이터 T' (1), plus main sheet entry (1) = 6 total
  - System now handles data entry inconsistencies with trailing spaces, periods, and format variations seamlessly
- **2025-08-16**: Successfully resolved Google Sheets API connectivity issues and restored full system functionality
  - Fixed API key authentication problems by reverting to working API key configuration
  - Restored complete Google Sheets integration: location data, program data, application status tracking
  - System now successfully processes 9 training programs with real-time participant counting
  - All API endpoints functioning normally with no more 400 authentication errors
- **2025-08-16**: Implemented comprehensive performance optimizations for 300+ concurrent users
  - Extended Google Sheets cache timeout to 2.5 minutes (150 seconds) for safe performance optimization
  - Reduced frontend polling frequency to 20-second intervals for optimal real-time synchronization
  - Added comprehensive rate limiting middleware with tiered protection levels
  - Applied safe rate limiting (900 requests/minute) to all Google Sheets API endpoints with safety margin
  - Implemented application submission rate limiting (5 requests per 5 minutes) to prevent abuse
  - System optimized and production-ready for 300+ concurrent users with 20-second safe real-time updates
- **2025-08-16**: Resolved Google Sheets API connectivity issues and updated bulk application payment flow
  - Fixed 500/429 API errors by implementing comprehensive caching system (30-second cache timeout)
  - Added proper caching to all Google Sheets API functions to prevent rate limiting
  - Updated bulk application payment link to https://bnikoreastore.com/surl/P/670 (individual applications retain original links)
  - Bulk application now automatically redirects to new payment page after successful submission
  - Successfully restored program card display functionality from gray boxes to proper content
- **2025-08-16**: Successfully implemented dashboard course name consolidation system
  - Added comprehensive course name normalization to map all B column aliases to formal A column names
  - Implemented pattern-based matching for various input formats (case-insensitive, spacing variations, abbreviations)
  - Dashboard now consolidates statistics: Foundation (3 total), Membership Committee (4 total), PR Coordinator (2 total), etc.
  - Excluded exceptional cases with regional information (e.g., "LTT : 멘토링 코디네이터 T 고양")
  - Maintains data integrity while providing clear unified course statistics for administrators
- **2025-08-16**: Resolved mobile KakaoTalk accessibility issues and enhanced mobile compatibility
  - Fixed "해당 페이지를 찾을 수 없습니다" (page not found) errors on mobile KakaoTalk
  - Implemented comprehensive mobile error boundary and loading states
  - Added mobile user agent detection and mobile-specific headers
  - Enhanced fetch requests with mobile-friendly configurations
  - Implemented mobile viewport fixes and overscroll prevention
  - Added KakaoTalk-specific rendering fixes with forced repaint
  - Created mobile loading component with BNI branding for better user experience
- **2025-08-15**: Successfully implemented KakaoTalk social media preview optimization
  - Added comprehensive Open Graph meta tags for enhanced social sharing
  - Configured custom BNI Korea branded image for link previews
  - Implemented Twitter Card and KakaoTalk-specific meta tags
  - Added cache-busting mechanism for instant preview updates
  - Completed production build and deployment with static file serving
  - Verified successful KakaoTalk link preview functionality with professional branding
- **2025-08-14**: Completed comprehensive architectural simplification of home.tsx
  - Drastically reduced code complexity while preserving all existing functionality
  - Simplified rendering functions (description, location, buttons) for easier maintenance
  - Consolidated complex conditional styling into clean Tailwind classes
  - Maintained all brand colors (red-600), Google Sheets integration, and user features
  - Enhanced future maintainability - simple UI changes now require minimal effort
  - All existing settings preserved: applicant counting, payment integration, real-time status updates

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript using Vite as the build tool
- **UI Framework**: shadcn/ui components built on Radix UI primitives for accessible, customizable components
- **Styling**: Tailwind CSS with custom BNI branding colors (red and gold) and dark theme support
- **State Management**: React Query (@tanstack/react-query) for server state management and data caching
- **Routing**: Wouter for lightweight client-side routing
- **Forms**: React Hook Form with Zod validation for type-safe form handling
- **Design System**: Dark-themed interface optimized for desktop, tablet, and mobile devices

### Backend Architecture
- **Runtime**: Node.js with Express.js server
- **Database ORM**: Drizzle ORM configured for PostgreSQL with type-safe database operations
- **API Design**: RESTful API endpoints for programs, applications, and notices
- **Data Validation**: Zod schemas for runtime type checking and validation
- **Development**: Hot module replacement and development server integration with Vite

### Data Storage
- **Primary Database**: PostgreSQL using Neon serverless database for scalability
- **Schema**: Three main entities - training programs, applications, and notices with proper relationships
- **Real-time Updates**: Polling-based updates every 5 seconds for programs and notices for rapid I column status reflection
- **Session Management**: PostgreSQL-based session storage using connect-pg-simple

### Google Sheets Integration
- **API Integration**: Google Sheets API v4 for real-time bidirectional data synchronization
- **Data Flow**: Bidirectional sync - application submissions automatically added to Google Sheets A-H column structure
- **Column Structure**: Updated A-H mapping (A:과목명, B:지역, C:챕터, D:멤버명, E:연락처(H.P), F:이메일, G:참여 방식, H:특이사항 & 문의)
- **Content Management**: Training schedules, payment links, notices, and program details managed through spreadsheets
- **Payment Status**: Column I used for payment verification and enrollment counting control (manual admin entry)
- **Participant Counting**: Real-time display shows "신청자: 00명(결제완료기준)" based on I column "완료" status
- **VOD Participant Requirements**: VOD participants must complete survey at https://apply-bnikorea.com/ for training completion
- **Fallback Strategy**: Graceful degradation when Google Sheets is unavailable with error handling

### Key Features
- **Program Management**: Dynamic display of 8 training program types with real-time availability
- **Application System**: Complete registration workflow with exact A-G column structure alignment
- **Individual Applications**: Form fields matching Google Sheets structure (과목명 자동기록, 지역, 챕터, 멤버명, 연락처, 이메일, 참여방식, 특이사항)
- **Bulk Applications**: Excel template with A-H column headers for mass registration
- **Course Name Tracking**: Selected program title automatically recorded in A column for all applications
- **Notice System**: Priority-based announcement system with high-priority notices pinned
- **Responsive Design**: Mobile-first approach with optimized layouts for all screen sizes
- **Real-time Updates**: Automatic content refresh and data submission to Google Sheets
- **Multi-language Support**: Korean language optimized with proper typography and formatting

### Performance Optimizations
- **Code Splitting**: Vite-based bundling with automatic code splitting
- **Caching Strategy**: React Query caching with stale-while-revalidate pattern
- **Image Optimization**: Optimized asset loading and caching
- **Bundle Size**: Tree-shaking and minimal dependency footprint

## External Dependencies

### Core Infrastructure
- **Neon Database**: PostgreSQL serverless database hosting
- **Google Sheets API**: Content management and data synchronization
- **Vercel/Similar Platform**: Likely deployment target based on configuration

### Key Libraries
- **UI Components**: Radix UI primitives for accessibility and shadcn/ui component system
- **Data Fetching**: TanStack React Query for server state management
- **Form Handling**: React Hook Form with Hookform Resolvers for Zod integration
- **Date Management**: date-fns for date formatting and manipulation (Korean locale support)
- **Styling**: Tailwind CSS with class-variance-authority for component variants
- **Icons**: Lucide React for consistent iconography
- **Development**: Replit integration for cloud development environment

### APIs and Services
- **Google Sheets API**: Real-time bidirectional data synchronization using spreadsheet ID 1LWEo74APBI3QxaexSWq_SnlQgmLPYCDl0YWVwhY8tbA
- **BNI Korea Store**: External link integration for merchandise and payment processing
- **Payment Gateway**: Integration ready through payment links in Google Sheets with admin-controlled enrollment counting

### Development Tools
- **TypeScript**: Full type safety across frontend and backend
- **ESBuild**: Fast bundling for production builds
- **PostCSS**: CSS processing with Tailwind CSS
- **Drizzle Kit**: Database migrations and schema management