# 프로바이더 Capability Registry (v1.1)

v1.0 §11.2의 요구사항 — "프로바이더의 모델명·라이선스 정책·가격·컨텍스트 한계·출력 포맷을
비즈니스 로직에 하드코딩하지 말고, 버전이 있는 capability registry에 저장한다" — 을
실제 스키마로 확정한 문서입니다.

구현: `assets/js/domain/capability.js` (`PROVIDERS`, `readinessGate()`, `resolveExecutionPlan()`)

## 세 가지 원칙

1. **모르는 값은 추측하지 않는다.** `null` 또는 `"unverified"`로 남긴다.
   불린 `false`와 "확인되지 않음"은 완전히 다른 상태다.
2. **`commercial` 블록은 서명된 계약서에서만 채운다.** 마케팅 페이지는 출처가 아니다.
3. **준비 게이트를 통과하지 못한 프로바이더에는 유료 트래픽을 보내지 않는다.**
   이건 문서상의 약속이 아니라 코드에서 거부한다.

## 준비 게이트 (readiness gate)

다음 중 하나라도 해당되면 `ready: false`이고 유료 라우팅이 차단됩니다.

| 차단 코드 | 조건 |
|---|---|
| `commercial_use_unverified` | `commercialUseAllowed !== true` |
| `no_contract_on_file` | `contractOnFile === false` |
| `training_on_user_data_unresolved` | `trainingOnUserData !== false` |
| `retention_unknown` | `dataRetentionDays === null` |
| `regions_unknown` | `regions` 가 빈 배열 |
| `cost_unknown` | 분당·요청당 단가가 모두 `null` |

`termsVersion`이 바뀌면 게이트를 다시 통과해야 합니다. 약관 변경은 §23의
"프로바이더가 조건을 바꾼다" 위험의 실제 발생 형태입니다.

## 스키마 (JSON Schema 2020-12)

```json
{
  "title": "SoundFit provider capability registry",
  "type": "object",
  "required": ["registryVersion", "providers"],
  "additionalProperties": false,
  "properties": {
    "registryVersion": {
      "type": "string",
      "description": "프로바이더 엔트리가 바뀔 때마다 올린다. GenerationRun에서 참조해 재현성을 확보한다.",
      "examples": ["2026-08-01.1"]
    },
    "providers": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/provider" } }
  },
  "$defs": {
    "tri": {
      "description": "검증된 불린 또는 명시적 미검증. 증거가 없는 것은 false가 아니다.",
      "oneOf": [{ "type": "boolean" }, { "const": "unverified" }, { "const": "unknown" }]
    },
    "provider": {
      "type": "object",
      "required": ["id", "kind", "displayName", "status", "capabilities", "commercial", "cost", "latency"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string", "pattern": "^[a-z0-9-]+$" },
        "kind": {
          "type": "string",
          "enum": ["text", "music_generation", "voice_synthesis", "audio_analysis", "similarity_detection", "mastering"]
        },
        "displayName": { "type": "string" },
        "modelId": {
          "type": ["string", "null"],
          "description": "요청에 사용하는 정확한 모델·버전 문자열. 모든 GenerationRun에 기록한다."
        },
        "status": {
          "type": "string",
          "enum": ["evaluation", "active", "deprecated", "disabled"],
          "description": "active이고 준비 게이트를 통과한 경우에만 유료 트래픽을 받는다."
        },
        "capabilities": {
          "type": "object",
          "required": ["asyncJobs", "sectionRevision", "instrumental", "vocals", "maxDurationSeconds", "outputFormats"],
          "additionalProperties": false,
          "properties": {
            "asyncJobs": { "$ref": "#/$defs/tri" },
            "sectionRevision": {
              "$ref": "#/$defs/tri",
              "description": "곡 전체를 다시 만들지 않고 지정 구간만 재생성할 수 있을 때만 true. 아니면 수정 요청은 전체 재생성으로 폴백되며 사용자에게 고지해야 한다."
            },
            "instrumental": { "$ref": "#/$defs/tri" },
            "stems": { "$ref": "#/$defs/tri" },
            "vocals": {
              "oneOf": [
                { "type": "string", "enum": ["none", "synthetic_guide_only", "model_voices", "licensed_singer_models", "unknown"] },
                { "const": "unverified" }
              ]
            },
            "lyricConditioned": { "$ref": "#/$defs/tri" },
            "seedReproducible": {
              "$ref": "#/$defs/tri",
              "description": "설명 가능한 A/B 변형과, 분쟁 시 결과 재현에 필요하다."
            },
            "maxDurationSeconds": { "type": ["number", "null"], "minimum": 0 },
            "outputFormats": {
              "type": "array",
              "items": { "type": "string", "enum": ["mp3", "aac", "ogg", "flac", "wav16", "wav24", "wav32f"] }
            },
            "sampleRates": { "type": "array", "items": { "type": "integer" } },
            "concurrencyLimit": { "type": ["integer", "null"] },
            "rateLimitPerMinute": { "type": ["integer", "null"] }
          }
        },
        "commercial": {
          "type": "object",
          "required": [
            "commercialUseAllowed", "resaleAllowed", "attributionRequired", "trainingOnUserData",
            "dataRetentionDays", "regions", "termsVersion", "contractOnFile"
          ],
          "additionalProperties": false,
          "properties": {
            "commercialUseAllowed": { "$ref": "#/$defs/tri" },
            "resaleAllowed": { "$ref": "#/$defs/tri" },
            "attributionRequired": { "$ref": "#/$defs/tri" },
            "trainingOnUserData": {
              "$ref": "#/$defs/tri",
              "description": "제출된 스토리·가사·오디오로 학습하는지. false로 검증되기 전에는 사용자 스토리를 보내지 않는다."
            },
            "dataRetentionDays": { "type": ["integer", "null"], "minimum": 0 },
            "regions": {
              "type": "array",
              "items": { "type": "string" },
              "description": "ISO 국가 코드 또는 ['*']. 빈 배열은 미확인이며 게이트를 차단한다."
            },
            "termsVersion": { "type": ["string", "null"] },
            "contractOnFile": { "type": "boolean" },
            "reviewedBy": { "type": ["string", "null"] },
            "reviewedAt": { "type": ["string", "null"], "format": "date-time" }
          }
        },
        "cost": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "perMinuteUsd": { "type": ["number", "null"], "minimum": 0 },
            "perRequestUsd": { "type": ["number", "null"], "minimum": 0 },
            "minimumCommitmentUsd": { "type": ["number", "null"], "minimum": 0 },
            "notes": { "type": "string" }
          }
        },
        "latency": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "p50Seconds": { "type": ["number", "null"], "minimum": 0 },
            "p95Seconds": { "type": ["number", "null"], "minimum": 0 },
            "measuredAt": { "type": ["string", "null"], "format": "date-time" },
            "sampleSize": { "type": ["integer", "null"] }
          }
        },
        "readiness": {
          "type": "object",
          "description": "작성하지 않고 파생시킨다. readinessGate() 참조.",
          "additionalProperties": false,
          "properties": {
            "ready": { "type": "boolean" },
            "blocking": {
              "type": "array",
              "items": {
                "type": "string",
                "enum": [
                  "unknown_provider", "commercial_use_unverified", "no_contract_on_file",
                  "training_on_user_data_unresolved", "retention_unknown", "regions_unknown", "cost_unknown"
                ]
              }
            },
            "evaluatedAt": { "type": "string", "format": "date-time" }
          }
        }
      }
    }
  }
}
```

## 실행 계획 결정 (resolveExecutionPlan)

수정 요청이 들어오면 **의도의 선언된 범위가 아니라 프로바이더의 실제 capability와
변경된 구간 수**로 실행 방식을 정합니다.

```
sectionRevision === true  AND  scope === 'section'  AND  변경구간 < 전체구간
  → section_patch     : 변경 구간만, 예상 시간·원가를 구간 비율로 산정
그 밖의 모든 경우
  → full_regenerate   : 전체 재생성. 사용자에게 이유와 소요 시간을 먼저 고지
                        fallbackReason: 'provider_does_not_support_section_revision'
```

Phase 0에서 반드시 실측해야 하는 값(추정 금지): `sectionRevision`, `stems`,
`seedReproducible`, `maxDurationSeconds`, `p95Seconds`, 그리고 `commercial` 전체.
