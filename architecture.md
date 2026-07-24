# Архитектура — Stars Clash

## 1. Системная архитектура

```mermaid
graph TB
    subgraph "Client"
        TMA[Telegram Mini App<br/>Flutter / React]
    end

    subgraph "Backend (Supabase)"
        PG[(PostgreSQL)]
        RL[Realtime]
        EF[Edge Functions]
        AUTH[Auth]
    end

    subgraph "External"
        TG[Telegram Bot API]
    end

    TMA -->|"REST"| EF
    TMA -->|"WS"| RL
    EF --> PG
    TMA --> AUTH
    TG --> TMA
```

## 2. Навигация

```
HomeScreen (главная)
  ├── DuelArena (создание/поиск дуэли)
  ├── Leaderboard (таблица лидеров)
  ├── Profile (профиль)
  └── Settings (настройки)
```

## 3. Дизайн-токены

| Токен | Значение |
|-------|----------|
| **Фон** | `primaryBackground` (темный) |
| **Карточки** | `secondaryBackground` (чуть светлее фона) |
| **Акцент** | `primary` (главный цвет) |
| **Доп. акцент** | `tertiary` |
| **Текст** | `primaryText` / `secondaryText` |
| **Границы** | `alternate` |
| **Успех** | `success` (зеленый) |
| **Ошибка** | `error` (красный) |
| **Шрифт заголовков** | Outfit, w800-w900 |
| **Шрифт текста** | Plus Jakarta Sans, w400 |
| **Радиус** | 24 / 28 / 9999 (pill) |

## 4. Главный экран (HomeScreen)

```mermaid
graph TB
    subgraph "HomeScreen"
        HEADER[Row: Stars Clash<br/>Welcome, Commander<br/>⭐ 1250]
        MATCHMAKING[Matchmaking Card<br/>🎮 MATCHMAKING<br/>Gradient Shader BG]
        ACTIONS[Row: Create / Find<br/>ActionCard x2]
        PERFORMANCE[Your Performance Card<br/>Wins | Losses<br/>Win Rate]
        CLASHES[Latest Clashes<br/>ClashRow список]
    end
```

## 5. Layout HomeScreen

```
┌──────────────────────────────┐
│ STARS CLASH          ⭐ 1250 │
│ Welcome, Commander           │
├──────────────────────────────┤
│ ┌──────────────────────────┐ │
│ │     gradient bg          │ │
│ │       🎮                 │ │
│ │   MATCHMAKING            │ │
│ └──────────────────────────┘ │
│ ┌──────────┐ ┌──────────┐   │
│ │  Create  │ │   Find   │   │
│ │Start Duel│ │Matchmake │   │
│ └──────────┘ └──────────┘   │
│ ┌──────────────────────────┐ │
│ │ YOUR PERFORMANCE         │ │
│ │ ┌──────┐ ┌──────┐       │ │
│ │ │Wins  │ │Losses│       │ │
│ │ │  12  │ │   3  │       │ │
│ │ └──────┘ └──────┘       │ │
│ │ ─────────────────────── │ │
│ │ Win Rate          80%   │ │
│ └──────────────────────────┘ │
│ LATEST CLASHES    View All   │
│ ┌──────────────────────────┐ │
│ │ Win vs. @player          │ │
│ │ ✊ vs. ✋ • 2m ago   +50 │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

## 6. Data Model

```mermaid
erDiagram
    users ||--o{ duels: ""
    users ||--o{ stars_transactions: ""

    users {
        uuid id PK
        bigint telegram_id UK
        text username
        text avatar_url
        int stars "default 1250"
        int total_wins
        int total_losses
        timestamptz created_at
    }

    duels {
        uuid id PK
        uuid creator_id FK
        uuid opponent_id FK
        text result "Win | Loss | Draw"
        text user_choice "rock | paper | scissors"
        text opponent_choice
        text opponent_name
        int stakes
        text status "pending | completed | cancelled"
        timestamptz created_at
        timestamptz completed_at
    }

    stars_transactions {
        uuid id PK
        uuid user_id FK
        uuid duel_id FK
        int amount "positive or negative"
        text type "bet | win | loss | refund"
        timestamptz created_at
    }
```

## 7. Data Flow — Дуэль

```mermaid
sequenceDiagram
    participant U1 as Player 1
    participant TMA as Mini App
    participant EF as Edge Function
    participant PG as Supabase
    participant RL as Realtime
    participant U2 as Player 2

    U1->>TMA: Create Duel (ставка 50⭐)
    TMA->>EF: POST /duel/create
    EF->>PG: INSERT duel (status=pending)
    EF-->>TMA: duel_id + invite link
    TMA->>U1: Отправить ссылку сопернику

    U2->>TMA: Переходит по ссылке
    TMA->>EF: POST /duel/join { duel_id, choice }
    EF->>PG: UPDATE duel (opponent_id, status=active)

    U1->>TMA: Выбирает ✊✋✌️
    TMA->>EF: POST /duel/move { duel_id, choice }
    EF->>EF: check both choices ready
    alt Both chosen
        EF->>EF: calculate result
        EF->>PG: UPDATE duel (result, stars)
        EF->>RL: broadcast result
        RL-->>TMA: result
        TMA-->>U1: Win/Lose/Draw +/- stars
        RL-->>U2: result
        TMA-->>U2: Win/Lose/Draw +/- stars
    end
```

## 8. Edge Functions

| Функция | Описание |
|---------|----------|
| `duel-create` | Создать дуэль, заморозить звезды |
| `duel-join` | Присоединиться к дуэли |
| `duel-move` | Сделать ход (КНБ) |
| `duel-resolve` | Подсчет результата, перевод звезд |
| `leaderboard` | Топ игроков по звездам |
| `profile-stats` | Статистика игрока |

## 9. Компоненты (Widget Tree)

```mermaid
graph TB
    subgraph "Components"
        AC[ActionCard<br/>icon, title, subtitle, bgColor]
        CR[ClashRow<br/>result, title, subtitle, amount]
        SP[StatPill<br/>value, label, color]
    end

    subgraph "Pages"
        HS[HomeScreen]
        DA[DuelArena]
        LB[Leaderboard]
        PR[Profile]
    end

    HS --> AC
    HS --> CR
    HS --> SP
    DA --> AC
    DA --> CR
```

## 10. App State

```yaml
userStars: 1250          # Текущий баланс звезд
historyFilter: "All"     # Фильтр истории
leaderboardCategory: "Total Stars"
```

## 11. Структура проекта

```
stars-clash/
├── lib/
│   ├── components/
│   │   ├── action_card/
│   │   ├── clash_row/
│   │   └── stat_pill/
│   ├── pages/
│   │   ├── home_screen/
│   │   ├── duel_arena/
│   │   ├── leaderboard/
│   │   └── profile/
│   ├── backend/
│   │   └── backend.dart
│   ├── flutter_flow/
│   └── main.dart
├── supabase/
│   ├── functions/
│   └── migrations/
└── pubspec.yaml
```
