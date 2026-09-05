import { DynamoDBClient, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { emptyMemory, type HouseholdMemory } from '@fca/domain';
import { nextVersion, VersionConflict, type MemoryRepository } from './repository.ts';

/**
 * DynamoDB single-table storage.
 *
 *   PK = HOUSEHOLD#<id>   SK = MEMORY
 *
 * The household id is the partition key, so isolation is a property of the
 * data model. Optimistic concurrency via a condition on `version`.
 */
export class DynamoMemoryRepository implements MemoryRepository {
  readonly householdId: string;
  readonly #doc: DynamoDBDocumentClient;
  readonly #table: string;

  constructor(householdId: string, table: string, client?: DynamoDBClient) {
    this.householdId = householdId;
    this.#table = table;
    this.#doc = DynamoDBDocumentClient.from(client ?? new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  get #pk(): string {
    return `HOUSEHOLD#${this.householdId}`;
  }

  async load(): Promise<HouseholdMemory> {
    const res = await this.#doc.send(
      new GetCommand({ TableName: this.#table, Key: { PK: this.#pk, SK: 'MEMORY' } }),
    );
    if (res.Item === undefined) return emptyMemory(this.householdId);
    const { PK: _pk, SK: _sk, ...memory } = res.Item as HouseholdMemory & { PK: string; SK: string };
    return memory;
  }

  async save(memory: HouseholdMemory): Promise<HouseholdMemory> {
    if (memory.householdId !== this.householdId) {
      throw new Error(`Refusing to save memory for ${memory.householdId} through a repository for ${this.householdId}`);
    }
    const next = nextVersion(memory);
    try {
      await this.#doc.send(
        new PutCommand({
          TableName: this.#table,
          Item: { PK: this.#pk, SK: 'MEMORY', ...next },
          // Either the row does not exist yet, or it is still at the version
          // this memory was loaded from. Deciding "first write" by inspecting
          // the new memory was wrong: the very first confirm already carries a
          // product, and the row did not exist, so the write failed.
          ConditionExpression: 'attribute_not_exists(PK) OR version = :v',
          ExpressionAttributeValues: { ':v': memory.version },
        }),
      );
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) throw new VersionConflict(this.householdId);
      throw e;
    }
    return next;
  }
}
