#include "audio_cache.h"
#include "recording_policy.h"
#include "diagnostics.h"
#include <SPIFFS.h>
#include <LittleFS.h>
#include <esp_partition.h>
static fs::FS* cacheFs=nullptr;static File writing,reading;
static uint32_t cacheBytes=0,readOffset=0;static bool capturing=false,cacheReadError=false;
static uint32_t writeMaxMs=0,readMaxMs=0,finishMs=0,removeMs=0;
static const char* path="/voxi-turn.pcm";
static TaskHandle_t cleanupTask=nullptr;static volatile bool cleanupBusy=false;
static void closeFiles(){capturing=false;if(writing)writing.close();if(reading)reading.close();}
static void cleanupWorker(void*){
  while(true){ulTaskNotifyTake(pdTRUE,portMAX_DELAY);uint32_t at=millis();closeFiles();cacheFs->remove(path);removeMs=millis()-at;cleanupBusy=false;}
}

bool audioCacheInit(){
  if(LittleFS.begin(false,"/littlefs",3,"storage"))cacheFs=&LittleFS;
  else if(SPIFFS.begin(false,"/spiffs",3,"storage")){
    // Migrate only this application's disposable cache, never unknown user files.
    bool ownedOnly=true;File dir=SPIFFS.open("/");
    if(!dir)ownedOnly=false;
    for(File entry=dir.openNextFile();entry;entry=dir.openNextFile()){
      String name=entry.name();if(entry.isDirectory()||(name!="voxi-turn.pcm"&&name!="/voxi-turn.pcm"))ownedOnly=false;
      entry.close();
    }
    dir.close();
    if(ownedOnly){SPIFFS.end();if(LittleFS.begin(true,"/littlefs",3,"storage"))cacheFs=&LittleFS;}
    else cacheFs=&SPIFFS;
  }
  else{
    auto part=esp_partition_find_first(ESP_PARTITION_TYPE_DATA,ESP_PARTITION_SUBTYPE_DATA_SPIFFS,"storage");
    if(!part){diagnosticError("Audio cache partition missing");return false;}
    uint8_t* block=(uint8_t*)malloc(4096);if(!block)return false;
    bool blank=true;
    for(size_t offset=0;offset<part->size&&blank;offset+=4096){
      size_t n=min((size_t)4096,(size_t)(part->size-offset));
      if(esp_partition_read(part,offset,block,n)!=ESP_OK){blank=false;break;}
      for(size_t i=0;i<n;i++)if(block[i]!=0xff){blank=false;break;}
      delay(1);
    }
    free(block);
    // Never format an unrecognised filesystem or any non-blank partition.
    if(blank&&LittleFS.begin(true,"/littlefs",3,"storage"))cacheFs=&LittleFS;
  }
  if(!cacheFs){diagnosticError("Audio cache unavailable; existing data left untouched");return false;}
  if(xTaskCreate(cleanupWorker,"cache-cleanup",4096,nullptr,1,&cleanupTask)!=pdPASS){diagnosticError("Cache cleanup task unavailable");cacheFs=nullptr;return false;}
  return true;
}
bool audioCacheStart(){
  if(!cacheFs||cleanupBusy)return false;audioCacheClose();
  size_t freeBytes=cacheFs==&SPIFFS?SPIFFS.totalBytes()-SPIFFS.usedBytes():LittleFS.totalBytes()-LittleFS.usedBytes();
  File old=cacheFs->open(path,FILE_READ);size_t reclaim=old?old.size():0;old.close();
  if(freeBytes+reclaim<RECORDING_MAX_BYTES+65536){diagnosticError("Recording cache needs 1MB free");return false;}
  writing=cacheFs->open(path,FILE_WRITE);cacheBytes=readOffset=0;cacheReadError=false;
  writeMaxMs=readMaxMs=finishMs=removeMs=0;capturing=(bool)writing;return capturing;
}
bool audioCacheWrite(const uint8_t* data,size_t n){
  uint32_t at=millis();if(!writing||n%2||n>RECORDING_MAX_BYTES-cacheBytes)return false;
  if(writing.write(data,n)!=n)return false;cacheBytes+=n;writeMaxMs=max(writeMaxMs,millis()-at);return true;
}
bool audioCacheFinish(){
  if(!writing)return false;uint32_t at=millis();writing.flush();writing.close();capturing=false;finishMs=millis()-at;return true;
}
bool audioCacheOpenUpload(size_t offset){
  if(!cacheFs||capturing||cleanupBusy||offset>cacheBytes)return false;
  if(reading)reading.close();reading=cacheFs->open(path,FILE_READ);readOffset=offset;cacheReadError=false;
  return reading&&reading.size()==cacheBytes&&reading.seek(offset);
}
size_t audioCacheRead(uint8_t* data,size_t capacity){
  uint32_t at=millis();if(!reading||readOffset>=cacheBytes)return 0;
  size_t n=min(capacity,(size_t)(cacheBytes-readOffset));int got=reading.read(data,n);
  if(got<=0){cacheReadError=true;return 0;}
  readOffset+=got;readMaxMs=max(readMaxMs,millis()-at);return got;
}
bool audioCacheEnd(){return !capturing&&!cacheReadError&&readOffset==cacheBytes;}
void audioCacheClose(){if(!cleanupBusy)closeFiles();}
void audioCacheRemove(){if(!cleanupBusy&&cleanupTask){cleanupBusy=true;xTaskNotifyGive(cleanupTask);}}
bool audioCacheBusy(){return cleanupBusy;}
void audioCacheDiagnostics(JsonDocument& out){
  out["cacheFilesystem"]=cacheFs==&LittleFS?"littlefs":cacheFs==&SPIFFS?"spiffs":"none";out["cacheCleanupBusy"]=cleanupBusy;out["cacheWriteMaxMs"]=writeMaxMs;out["cacheReadMaxMs"]=readMaxMs;out["cacheFinishMs"]=finishMs;out["cacheRemoveMs"]=removeMs;
  out["recordingMaxMs"]=RECORDING_MAX_MS;out["audioCacheCapacityBytes"]=RECORDING_MAX_BYTES;out["audioCacheReady"]=cacheFs!=nullptr;out["audioCacheBytes"]=cacheBytes;
}
