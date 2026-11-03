#include "../firmware-c6/include/amoled_controls.h"
#include <assert.h>
int main(){
 assert(amoledTouchAction(true,180,360)==AmoledAction::Ptt);
 assert(amoledTouchAction(false,180,360)==AmoledAction::None);
 assert(amoledTouchAction(true,15,360)==AmoledAction::None);
 assert(amoledTouchAction(true,352,360)==AmoledAction::None);
 assert(amoledTouchAction(true,180,396)==AmoledAction::None);
 assert(amoledTouchAction(true,40,420)==AmoledAction::Previous);
 assert(amoledTouchAction(true,180,420)==AmoledAction::Setup);
 assert(amoledTouchAction(true,300,420)==AmoledAction::Next);
 assert(amoledTouchAction(true,105,420)==AmoledAction::None);
 assert(amoledTouchAction(true,260,420)==AmoledAction::None);
 assert(amoledTouchAction(true,40,437)==AmoledAction::None);
}
