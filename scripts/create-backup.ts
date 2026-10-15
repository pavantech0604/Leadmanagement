import {readStore} from '../lib/store';
import {writeSnapshot} from '../lib/backups';
async function main(){const result=await writeSnapshot(await readStore());console.log('Backup created: '+result.destination)}main();
