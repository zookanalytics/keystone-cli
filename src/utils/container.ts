export type Factory<T> = (container: Container) => T;

export class Container {
  private services = new Map<string, any>();
  private factories = new Map<string, Factory<any>>();

  /**
   * Register a singleton instance.
   */
  register<T>(name: string, instance: T): void {
    this.services.set(name, instance);
  }

  /**
   * Register a factory function for a service.
   * The factory is called only once when the service is first resolved.
   */
  factory<T>(name: string, factory: Factory<T>): void {
    this.factories.set(name, factory);
  }

  /**
   * Resolve a service by name.
   */
  resolve<T>(name: string): T {
    if (this.services.has(name)) {
      return this.services.get(name);
    }

    const factory = this.factories.get(name);
    if (factory) {
      const instance = factory(this);
      this.services.set(name, instance);
      return instance;
    }

    throw new Error(`Service not found: ${name}`);
  }

  /**
   * Resolve a service by name, or return undefined if not found.
   */
  resolveOptional<T>(name: string): T | undefined {
    try {
      return this.resolve<T>(name);
    } catch {
      return undefined;
    }
  }

  /**
   * Clear all registered services and factories.
   */
  clear(): void {
    this.services.clear();
    this.factories.clear();
  }
}

/**
 * Global application container instance.
 */
export const container = new Container();
