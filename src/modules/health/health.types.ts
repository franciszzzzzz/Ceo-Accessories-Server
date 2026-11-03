export interface HealthChecks {
  database(): Promise<void>;
  redis(): Promise<void>;
}

export interface ReadinessResult {
  ready: boolean;
  checks: {
    database: "up" | "down";
    redis: "up" | "down";
  };
}
