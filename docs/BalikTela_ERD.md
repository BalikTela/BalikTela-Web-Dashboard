# BalikTela Prototype Entity-Relationship Diagram

> This document describes the current prototype API model. The finalized persistence contract for backend integration is [BalikTelaPH Shared Database Schema v1.0.3](BalikTela_Database_Schema_v1.md).

This ERD reflects the currently implemented server model in `server/types.ts`. The application uses MongoDB when `MONGODB_URI` is configured and an in-memory store for demonstration mode. IDs and relationships are maintained by the application; MongoDB foreign-key constraints are not currently enforced.

## Core ERD

```mermaid
erDiagram
    ORGANIZATION ||--o{ USER : has_members
    ORGANIZATION ||--o{ FACILITY : operates
    ORGANIZATION ||--o{ MATERIAL_BATCH : originates
    ORGANIZATION ||--o{ LISTING : owns
    ORGANIZATION ||--o{ RECOVERY_RECORD : performs

    USER ||--o{ MATERIAL_BATCH : records
    USER ||--o{ MATERIAL_BATCH : holds_custody
    USER ||--o{ LISTING : owns
    USER ||--o{ OFFER : provides
    USER ||--o{ OFFER : receives
    USER ||--o{ TRANSFER : provides
    USER ||--o{ TRANSFER : receives
    USER ||--o{ MEASUREMENT : records
    USER ||--o{ MESSAGE : sends
    USER ||--o{ WALLET_ENTRY : receives
    USER ||--o{ AUDIT_RECORD : performs
    USER ||--o{ RECOVERY_RECORD : records
    USER ||--o{ RECOVERY_RECORD : validates
    USER ||--o{ CONFIGURATION : updates

    MATERIAL_BATCH ||--o{ MEASUREMENT : has_history
    MATERIAL_BATCH ||--o{ LISTING : is_published_as
    MATERIAL_BATCH ||--o{ TRANSFER : is_traced_through
    MATERIAL_BATCH ||--o{ RECOVERY_RECORD : undergoes

    LISTING ||--o{ OFFER : receives
    LISTING ||--o{ TRANSFER : produces
    LISTING ||--o{ CONVERSATION : discusses

    OFFER ||--o| TRANSFER : becomes
    TRANSFER ||--o{ MEASUREMENT : has_stage_weights
    TRANSFER ||--o{ LIFECYCLE_EVENT : contains
    TRANSFER ||--o{ RECOVERY_RECORD : has_processing
    TRANSFER ||--o{ WALLET_ENTRY : releases_reward

    FACILITY ||--o{ RECOVERY_RECORD : handles
    CONVERSATION ||--o{ MESSAGE : contains
    USER }o--o{ CONVERSATION : participates_in

    ORGANIZATION {
        string id PK
        string name
        string type
        string verification
        string recordLabel
        string region
        string city
        string status
        string_array serviceAreas
        string_array acceptedMaterials
        string contactEmail
    }

    USER {
        string id PK
        string organizationId FK
        string email UK
        string passwordHash
        string fullName
        string role
        string city
        string region
        datetime joinedAt
        datetime consentAt
        string verification
        string accountStatus
        object scope
        object profile
        number trustPlaceholder
    }

    FACILITY {
        string id PK
        string organizationId FK
        string name
        string type
        string city
        string region
        string_array serviceAreas
        string_array acceptedMaterials
        number monthlyCapacityKg
        number currentIntakeKg
        string status
        string verification
        boolean isDemo
    }

    MATERIAL_BATCH {
        string id PK
        string sourceUserId FK
        string sourceOrganizationId FK
        string currentCustodianId FK
        string materialCategory
        string wasteSource
        string wasteForm
        string condition
        string circularPathway
        number declaredWeightKg
        number currentWeightKg
        string weightStatus
        number secondaryQuantity
        string secondaryUnit
        string city
        string region
        string currentStatus
        datetime createdAt
        datetime updatedAt
        boolean isDemo
    }

    MEASUREMENT {
        string id PK
        string batchId FK
        string transferId FK
        string recordedBy FK
        string verifiedBy FK
        string stage
        number weightKg
        string status
        string method
        datetime timestamp
        string note
    }

    LISTING {
        string id PK
        string batchId FK
        string ownerId FK
        string ownerOrganizationId FK
        string title
        string textileType
        string wasteSource
        string wasteForm
        string circularPathway
        number quantityKg
        string weightStatus
        string quality
        string exchangeFor
        number rewardCredits
        string city
        string region
        string status
        datetime createdAt
        boolean isDemo
    }

    OFFER {
        string id PK
        string listingId FK
        string providerId FK
        string recipientId FK
        number quantityKg
        string terms
        number offeredCredits
        string status
        datetime createdAt
        datetime updatedAt
    }

    TRANSFER {
        string id PK
        string listingId FK
        string batchId FK
        string offerId FK
        string providerId FK
        string recipientId FK
        string materialCategory
        number agreedWeightKg
        number handoverWeightKg
        number receiptWeightKg
        number verifiedWeightKg
        string status
        number discrepancyKg
        string circularOutcome
        number pendingRewardCredits
        datetime rewardIssuedAt
        datetime createdAt
        datetime updatedAt
        boolean isDemo
    }

    LIFECYCLE_EVENT {
        string id PK
        string actorId FK
        string measurementId FK
        string type
        datetime timestamp
        string status
        string location
        string note
    }

    RECOVERY_RECORD {
        string id PK
        string transferId FK
        string batchId FK
        string facilityId FK
        string organizationId FK
        string recordedBy FK
        string validatedBy FK
        string stage
        number inputWeightKg
        number outputWeightKg
        number residualWeightKg
        string outcome
        string status
        datetime timestamp
        string note
        boolean isDemo
    }

    CONVERSATION {
        string id PK
        string listingId FK
        string_array participantIds FK
        datetime updatedAt
    }

    MESSAGE {
        string id PK
        string conversationId FK
        string senderId FK
        string body
        datetime createdAt
    }

    WALLET_ENTRY {
        string id PK
        string userId FK
        string transferId FK
        string type
        number credits
        string description
        datetime createdAt
    }

    AUDIT_RECORD {
        string id PK
        string actorId FK
        string action
        string entityType
        string entityId
        datetime timestamp
        string details
    }

    CONFIGURATION {
        string id PK
        string updatedBy FK
        string_array materialCategories
        string_array wasteSources
        string_array wasteForms
        string_array circularPathways
        string_array facilityTypes
        string_array weightStatuses
        number discrepancyThresholdPercent
        number rewardCreditsPerVerifiedKg
        object matchingWeights
        string methodologyVersion
        datetime updatedAt
    }
```

## Embedded Structures

These structures are stored inside their parent records rather than in separate collections:

| Parent | Embedded structure | Important fields |
|---|---|---|
| User | Access scope | `organizationIds`, `facilityIds`, `regions`, `canExport`, `aggregateOnly` |
| User | Profile | age group, organization size, production volume, recycling practices, accepted textiles, sustainability interests |
| Transfer | Lifecycle events | event type, actor, timestamp, status, location, note, optional measurement reference |
| Configuration | Matching weights | category, pathway, region, condition, quantity |

## Relationship Notes

- An organization can have many users and facilities. A user or Material Batch may have no organization when it belongs to an individual participant.
- A Material Batch preserves its originating user and organization separately from its current custodian.
- Measurements form the weight-history record. They always reference a Material Batch and may also reference a transfer stage.
- A listing references one Material Batch. The model permits historical listings for the same batch because uniqueness is not currently enforced.
- An accepted offer can produce one transfer. Rejected, withdrawn, or pending offers do not have a transfer.
- Transfer lifecycle events are embedded in the transfer document, while measurements and recovery records are separate collections.
- Recovery records connect a transfer and Material Batch to the facility and organization performing collection, sorting, processing, recovery, or rejection.
- Conversations store participant IDs as an array, representing a many-to-many relationship between users and conversations.
- Audit targets are polymorphic: `entityType` and `entityId` may refer to users, organizations, batches, transfers, recovery records, configuration, or other audited records.
- Wallet entries are non-cash reward ledger entries. A transfer reference is optional for manual adjustments or future redemptions.

## Main Material-Flow Path

```mermaid
flowchart LR
    U[User / Organization] --> B[Material Batch]
    B --> M[Measurement History]
    B --> L[Material Listing]
    L --> O[Offer]
    O --> T[Transfer]
    T --> E[Lifecycle Events]
    T --> R[Recovery Records]
    R --> F[Facility]
    T --> W[Reward Ledger]
    T --> A[Audit Trail]
```

## Current Persistence Notes

- Production-style persistence is available through MongoDB when `MONGODB_URI` is present.
- Without MongoDB configuration, the server starts with a coherent in-memory demonstration dataset.
- Application IDs such as `USR-*`, `MB-*`, and `TRF-*` are the current primary identifiers.
- Fields ending in `Id` represent logical references, but referential integrity and cascade behavior are currently handled by application code.
