import { Watcher } from './watcher'
import 'dotenv/config';
import { RecastClient } from './recastclient';
import { RealtimeChannel, RealtimePostgresInsertPayload } from '@supabase/supabase-js';

export class UploadManager {
  private watcher: Watcher = new Watcher();
  private uploadChannel: RealtimeChannel;

  constructor(client: RecastClient) {
    this.initialize(client);
    this.uploadChannel = this.create_channel(client);
    this.uploadChannel.subscribe();
  }

  create_channel(client: RecastClient): RealtimeChannel {
     return client.supabase.channel('upload')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'upload', filter: "active=eq.true" },
        (payload: any) => {
          this.open(payload)
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'upload', filter: "active=eq.false"},
        (payload: any) => {
          this.close(payload)
        }
      )
  }

  async initialize(client: RecastClient): Promise<void> {
    const data = await this.check_for_active_upload(client);
    if (data !== null) {
      this.start_watcher(data.prefix);
    }
  }

  async check_for_active_upload(client: RecastClient): Promise<{ bucket: string, prefix: string } | null> {
    let { data, error } = await client.supabase.from('upload').select('bucket, prefix').is('active', true);

    if (data != null && data.length === 0) {
      console.log(`UploadManager: No active upload!`);
      return null;
    } else {
      let bucket: string = data && data[0].bucket;
      console.log(`UploadManager: Bucket "${bucket}".`);
      let prefix: string = data && data[0].prefix;
      console.log(`UploadManager: Prefix "${prefix}".`);
      return { bucket, prefix };
    }
  }

  start_watcher(prefix: string) {
    const path: string = './data/' + prefix;
    this.watcher.start(path);
  }

  stop_watcher(): string | undefined {
    return this.watcher.stop();
  }

  open<T extends { [key: string]: any }>(payload: RealtimePostgresInsertPayload<T>) {
    const prefix: string = payload.new.prefix;
    console.log(`UploadManager: Open upload for prefix "${prefix}"`);
    this.start_watcher(payload.new.prefix);
  }

  close<T extends { [key: string]: any }>(payload: RealtimePostgresInsertPayload<T>) {
    const prefix: string = payload.new.prefix;
    console.log(`UploadManager: Close upload for prefix "${prefix}"`);
    const path: string | undefined = this.stop_watcher();
    console.log(`UploadManager: Upload file "${path}"`)
    // TODO S3 Upload
  }
}

